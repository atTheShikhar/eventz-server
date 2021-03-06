const express = require('express');
const router = express.Router();
const { 
	bookFreeTicketsController, 
	bookPaidTicketsController,
	fetchTicketsController,
	verifyPaymentController, 
	verifyPaymentWebhookController
} = require('../controllers/tickets.controller');
const { verifyTicketsController, attendanceController } = require('../controllers/user.controller');
const authenticate = require('../middlewares/authenticate');
const validOrganiser = require('../middlewares/validOrganiser');
const validTicketRequest = require('../middlewares/validTicketRequest');

router.post("/book-tickets",
	authenticate("requestedBy"),
	validTicketRequest,
	bookFreeTicketsController,
	bookPaidTicketsController
)
//This route is called by the client to verify the payment 
router.post("/verify-payments",authenticate("requestedBy"),verifyPaymentController);
//This webhook is called by razorpay to verify paymentes
router.post("/verify-payments-webhook",verifyPaymentWebhookController);

router.post("/my-tickets",authenticate("requestedBy"),fetchTicketsController);

router.post('/verify-tickets',
	authenticate("requestedBy"),
	validOrganiser,
	verifyTicketsController
);

router.post('/attendance',
	authenticate("requestedBy"),
	validOrganiser,
	attendanceController
);

module.exports = router;