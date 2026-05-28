import pg from 'pg';
import { clinicorpApi } from './clinicorp.mjs';

const settings = {
  subscriber_id: 'sorrisominacu',
  api_token: '1af93b09-189a-4491-99c8-7a374e677e4a',
  enabled: true
};

async function debug() {
  console.log('Testing listClinics...');
  try {
    const clinics = await clinicorpApi.listClinics(settings);
    console.log('Clinics:', JSON.stringify(clinics, null, 2));
  } catch (e) {
    console.error('listClinics failed:', e.message);
  }

  console.log('\nTesting listUsers...');
  try {
    const users = await clinicorpApi.listUsers(settings);
    console.log('Users count:', users?.length);
    if (users?.length) console.log('Sample User:', JSON.stringify(users[0], null, 2));
  } catch (e) {
    console.error('listUsers failed:', e.message);
  }

  console.log('\nTesting listSubscribersClinics...');
  try {
    const subClinics = await clinicorpApi.listSubscribersClinics(settings);
    console.log('SubClinics:', JSON.stringify(subClinics, null, 2));
  } catch (e) {
    console.error('listSubscribersClinics failed:', e.message);
  }
}

debug();
