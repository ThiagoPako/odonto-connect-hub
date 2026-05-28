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
    console.log('Clinics:', JSON.stringify(clinics, null, 2));
    
    // Extract clinic ID from various possible structures
    let clinicId = null;
    if (Array.isArray(clinics)) {
      clinicId = clinics[0]?.id || clinics[0]?.BusinessId;
    } else if (clinics?.Results && Array.isArray(clinics.Results)) {
      clinicId = clinics.Results[0]?.id || clinics.Results[0]?.BusinessId;
    } else if (clinics?.data && Array.isArray(clinics.data)) {
      clinicId = clinics.data[0]?.id;
    }
    
    console.log('Detected Clinic ID:', clinicId);

    if (clinicId) {
      console.log(`\nTesting listEstimates (${lastMonth} to ${today})...`);
      const estimates = await clinicorpApi.listEstimates(settings, lastMonth, today, clinicId);
      console.log('Estimates result:', JSON.stringify(estimates, null, 2).slice(0, 1000));

      console.log(`\nTesting listPayments (${lastMonth} to ${today})...`);
      const payments = await clinicorpApi.listPayments(settings, { from: lastMonth, to: today, clinic_id: clinicId });
      console.log('Payments result:', JSON.stringify(payments, null, 2).slice(0, 1000));
    } else {
      console.error('No clinic ID found, cannot test other endpoints.');
    }
  } catch (err) {
    console.error('Debug failed:', err.message);
    if (err.body) console.error('Error body:', JSON.stringify(err.body, null, 2));
  }
}

runDebug();
