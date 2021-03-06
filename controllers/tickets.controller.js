const Ticket = require('../models/tickets.model');
const NewEvent = require('../models/events.model');
const Payments = require("../models/payments.model");
const User = require("../models/user.model");
const { nanoid } = require('nanoid');
const Razorpay = require('razorpay');
const generateTickets = require('../helpers/generateTickets');
require('dotenv').config({
    path: "../configs/config.env"
});

exports.bookFreeTicketsController = async (req,res,next) => {
    try {
        const {isFree} = req.body.eventData.eventDetails;
        // return res.json({status: "OK"});
        
        if(isFree === "Yes") {
            const {requestedBy,eventId,count,} = req.body;
            
            const createdTickets = await generateTickets(count,requestedBy,eventId);

            //Update Booked events in user data
            await User.findByIdAndUpdate(requestedBy,{
                $push: {
                    bookedEvents: eventId
                }
            })

            return res.status(200).json({
                message: "Tickets booked successfully!",
                createdTickets: createdTickets
            });
        }
        if(isFree === "No") {
            return next();
        }
        return res.status(500).json({error: "Server Error :("});
    } catch (e) {
        console.log(e);
        return res.status(500).json({error: "Server Error :("});
    }
}
exports.bookPaidTicketsController = async (req,res) => {
    const { price,title } = req.body.eventData.eventDetails;
    const { requestedBy,count,eventId,} = req.body;
    const amountInRs = parseInt(price);

    const payment_capture = 1
    const totalAmountInPaise = count * amountInRs * 100;         
    const currency = "INR"
    const description = `${count} ticket purchase for event: ${title}` 
    
    const options = {
        amount: totalAmountInPaise,
        currency,
        receipt: nanoid(),
        payment_capture
    }

    try {
        const razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEYID,
            key_secret: process.env.RAZORPAY_KEYSECRET
        })
        const response = await razorpay.orders.create(options);

        const paymentData = {
            order_id: response.id,
            payment_id: "null",
            amount: response.amount,
            amount_paid: response.amount_paid,
            amount_due: response.amount_due,
            currency: response.currency,
            receipt: response.receipt,
            payment_status: "pending",
            user_id: requestedBy,   
            event_id: eventId,
            ticket_count: count,
            description: description
        }
        //Save payment data to database with current status
        const payment = new Payments(paymentData)
        await payment.save();

        return res.status(200).json({
            id: response.id,
            currency: response.currency,
            amount: response.amount,
            description: description
        })
    } catch(e) {
        console.log(e);
        return res.status(500).json({error: "Server Error :("});
    }
}
exports.verifyPaymentController = async (req,res) => {
    const { payment_id,order_id,amount,status } = req.body;
    try {
        if(status==="captured") {
            const paymentDetails = await Payments.findOneAndUpdate({
                order_id,
                amount
            },{
                payment_status: "captured",
                amount_paid: amount,
                amount_due: 0,
                payment_id: payment_id
            });

            const {user_id,event_id,ticket_count} = paymentDetails; 
            //Generate tickets
            const createdTickets = await generateTickets(ticket_count,user_id,event_id);

            //Update Booked events in user data
            await User.findByIdAndUpdate(user_id,{
                $push: {
                    bookedEvents: event_id
                }
            })

            return res.status(200).json({
                message: "Tickets booked successfully!",
                createdTickets: createdTickets
            });
        } 
        if(status==="failed") {
            await Payments.findOneAndUpdate({
                order_id,
                amount
            },{
                payment_status: "failed",
                payment_id: payment_id
            }); 
            //Return with payment failed
            return res.status(400).json({error: "Payment failed :("})
        }
        return res.status(400).json({error: "Bad request!"});
    } catch(err) {
        console.log(err);
        return res.status(500).json({error: "Server Error :("});
    }
}
exports.verifyPaymentWebhookController = async (req,res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const { id,order_id,amount,status } = req?.body?.payload?.payment?.entity;

    const crypto = require('crypto');
    const shasum = crypto.createHmac('sha256', secret)
	shasum.update(JSON.stringify(req.body))
	const digest = shasum.digest('hex')

    try {
        if ((digest === req.headers['x-razorpay-signature']) && (status==="captured")) {
            await Payments.findOneAndUpdate({
                order_id,
                amount
            },{
                payment_status: "captured",
                amount_paid: amount,
                amount_due: 0,
                payment_id: id
            }); 
        } else {
            await Payments.findOneAndUpdate({
                order_id,
                amount
            },{
                payment_status: "failed",
                payment_id: id
            }); 
        }
    } catch(err) {
        console.log(err);
    }
        
    return res.status(200).json({status: "ok"})
}

exports.fetchTicketsController = async (req,res) => {
    try {
        const { requestedBy } = req.body;
        const tickets = await Ticket.find({userId: requestedBy});
        
        const ticketCount = tickets.length;

        //Extract unique eventids from all the tickets since a user can have multiple tickets for the same event
        const uniqueEventIds = tickets
            .map(item => (item.eventId.toString()))
            .reduce(
                (unique,item) => (unique.includes(item) ? unique : [...unique,item]),
                []
            )

        let eventData = [];
        for(let i=0;i<uniqueEventIds.length;i++) {
            const eventId = uniqueEventIds[i];
            const data = await NewEvent.findById(eventId);
            eventData.push(data);
        }

        const ticketData = eventData.map(item => {
            const eventId = item._id.toString();
            const ticketsForEachEvent = tickets.filter(i => (i.eventId.toString() === eventId));
            return ({
                tickets: ticketsForEachEvent,
                eventInfo: item,
            });
        })

        return res.json({totalTickets: ticketCount,ticketData});

    } catch(e) {
        console.log(e);
        return res.status(500).json({error: "Server Error :("});
    }
}

exports.getBookingsByEventsController = async (req,res) => {
    const { eventId } = req.body; 

    if(eventId == null) {
        return res.status(400).json({error: "eventId not received!"});
    }

    try {
        const tickets = await Ticket.find({eventId: eventId});
    
        if(tickets.length > 0) {
            const ticketUsers = [...new Set(tickets.map(item => item.userId.toString()))] 

            let bookingsData = [];
            for(let i=0;i<ticketUsers.length;i++) {
                const userId = ticketUsers[i];

                const userData = await User.findById(userId,{
                    name: 1,
                    email: 1,
                    _id: 1,
                    imageLocation: 1,
                    created_at: 1
                });

                const ticketCount = tickets.reduce((count,item) => {
                    return (item.userId.toString() === userId) ? ++count : count;
                },0);

                const ticketsAndUsers = {
                    ticketCount,
                    user: userData                    
                }
                bookingsData.push(ticketsAndUsers);
            }

            const ticketBookings = bookingsData.map((item) => {
                return {
                    ticketCount: item.ticketCount,
                    name: item.user.name.fname + " " + item.user.name.lname,
                    email: item.user.email,
                    _id: item.user._id,
                    // imageLocation: item?.user?.imageLocation,
                    joinedOn: new Date(item.user.created_at).toDateString()
                }
            });

            return res.status(200).json(ticketBookings);
        }
        //No Bookings
        return res.status(200).json([]);
    } catch(e) {
        console.log(e);
        return res.status(500).json({error: "Server Error :("});
    }
}