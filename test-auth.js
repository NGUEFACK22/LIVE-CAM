// Test d'authentification Supabase - pour diagnostic
// Executez avec Node.js: node test-auth.js

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ojmzqokffbptmcktnwdy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qbXpxb2tmZmJwdG1ja3Rud2R5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMTAzNTYsImV4cCI6MjA5NDg4NjM1Nn0.e9sk4b_15ge2LIIQwFpXC3n_q48ctu9IJ6oJxV85kgw';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testHealth() {
  console.log('🔍 Test de santé Supabase...');
  try {
    // Test avec la clé API pour vérifier l'authentification
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    console.log(`   Status: ${response.status}`);
    // 401 est attendu car pas de token valide, mais ça prouve que le serveur répond
    if (response.status === 401 || response.status === 200) {
      console.log('   ✅ Supabase répond (authentification requise)');
      return true;
    }
    const data = await response.json();
    console.log(`   Response: ${JSON.stringify(data)}`);
    return response.status < 500;
  } catch (error) {
    console.log(`   ERREUR: ${error.message}`);
    return false;
  }
}

async function testSignUp(email, password) {
  console.log(`\n📝 Test d'inscription avec ${email}...`);
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    
    if (error) {
      console.log(`   ERREUR: ${error.message}`);
      return false;
    }
    
    console.log(`   Inscrit avec succès! User ID: ${data.user?.id}`);
    return true;
  } catch (error) {
    console.log(`   ERREUR: ${error.message}`);
    return false;
  }
}

async function testSignIn(email, password) {
  console.log(`\n🔑 Test de connexion avec ${email}...`);
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error) {
      console.log(`   ERREUR: ${error.message}`);
      return false;
    }
    
    console.log(`   Connecté avec succès! User ID: ${data.user?.id}`);
    return true;
  } catch (error) {
    console.log(`   ERREUR: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('============================================================');
  console.log('ChapCam - Test d\'authentification Supabase');
  console.log('============================================================\n');
  
  const healthOk = await testHealth();
  if (!healthOk) {
    console.log('\n❌ Le serveur Supabase n\'est pas accessible.');
    console.log('   Vérifiez votre connexion Internet.');
    process.exit(1);
  }
  
  console.log('\n✅ Supabase est accessible.');
  
  // Test avec un compte de test
  const testEmail = `test_${Date.now()}@chapcam.test`;
  const testPassword = 'TestPassword123!';
  
  const signUpOk = await testSignUp(testEmail, testPassword);
  if (signUpOk) {
    const signInOk = await testSignIn(testEmail, testPassword);
    if (signInOk) {
      console.log('\n🎉 TOUT FONCTIONNE! Inscription et connexion OK.');
    } else {
      console.log('\n⚠️ Inscription OK mais connexion échouée.');
    }
  } else {
    console.log('\n⚠️ Inscription échouée.');
  }
}

main();