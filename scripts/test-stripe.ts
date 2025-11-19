import { config } from 'dotenv';
import path from 'path';
import Stripe from 'stripe';

// Load env from packages/web/.env.local
// Assuming this script is run from the root or scripts folder
const envPath = path.resolve(__dirname, '../packages/web/.env.local');
console.log(`Loading env from: ${envPath}`);
config({ path: envPath });

const key = process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_PRICE_ID;

console.log('Testing Stripe Connection...');
console.log(`Key prefix: ${key?.substring(0, 8)}...`);
console.log(`Price ID: ${priceId}`);

if (!key) {
    console.error('ERROR: STRIPE_SECRET_KEY is missing');
    process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: '2024-06-20' });

async function test() {
    try {
        if (priceId) {
            console.log('1. Retrieving Price...');
            const price = await stripe.prices.retrieve(priceId);
            console.log('✅ Price found:', price.id, price.active ? '(Active)' : '(Inactive)');
            if (!price.active) console.warn('⚠️ Warning: Price is inactive!');
        } else {
            console.warn('⚠️ STRIPE_PRICE_ID is missing, skipping price check.');
        }

        console.log('2. Listing Customers (Connection Check)...');
        const customers = await stripe.customers.list({ limit: 1 });
        console.log('✅ Connection successful. Found', customers.data.length, 'customers.');

    } catch (error: any) {
        console.error('❌ Stripe Error:', error.message);
    }
}

test();
