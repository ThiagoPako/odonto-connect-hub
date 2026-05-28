import pg from 'pg';
import { clinicorpApi } from './clinicorp.mjs';

const settings = {
  subscriber_id: 'sorrisominacu',
  api_token: '1af93b09-189a-4491-99c8-7a374e677e4a',
  base_url: 'https://api.clinicorp.com/rest/v1'
};

const today = new Date().toISOString().slice(0, 10);
const lastMonth = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

async function runDebug() {
  console.log('Testing Clinicorp API for subscriber:', settings.subscriber_id);
  
  try {
    const clinics = await clinicorpApi.listClinics(settings);
    console.log('Clinics:', clinics);
    const clinicId = clinics?.[0]?.id || clinics?.Results?.[0]?.id;
    console.log('Using Clinic ID:', clinicId);

    if (clinicId) {
      console.log(`\nTesting listEstimates (${lastMonth} to ${today})...`);
      const estimates = await clinicorpApi.listEstimates(settings, lastMonth, today, clinicId);
      console.log('Estimates result count:', Array.isArray(estimates) ? estimates.length : 'not an array');
      if (Array.isArray(estimates) && estimates.length > 0) {
        console.log('First estimate sample:', JSON.stringify(estimates[0], null, 2));
      } else {
        console.log('Estimates raw response:', JSON.stringify(estimates, null, 2));
      }

      console.log(`\nTesting listPayments (${lastMonth} to ${today})...`);
      const payments = await clinicorpApi.listPayments(settings, { from: lastMonth, to: today, clinic_id: clinicId });
      console.log('Payments result count:', Array.isArray(payments) ? payments.length : 'not an array');
      if (Array.isArray(payments) && payments.length > 0) {
        console.log('First payment sample:', JSON.stringify(payments[0], null, 2));
      } else {
        console.log('Payments raw response:', JSON.stringify(payments, null, 2));
      }
      
      console.log(`\nTesting listInvoices (${lastMonth} to ${today})...`);
      const invoices = await clinicorpApi.listInvoices(settings, { from: lastMonth, to: today, clinic_id: clinicId });
      console.log('Invoices result count:', Array.isArray(invoices) ? invoices.length : 'not an array');
    }
  } catch (err) {
    console.error('Debug failed:', err.message);
    if (err.body) console.error('Error body:', JSON.stringify(err.body, null, 2));
  }
}

runDebug();
