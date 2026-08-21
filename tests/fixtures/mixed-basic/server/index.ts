import express from 'express';
import Stripe from 'stripe';

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

function checkout() {
  return stripe.checkout.sessions.create({ mode: 'payment', line_items: [] });
}

app.post('/checkout', checkout);
app.listen(3000);
