// scripts/test-funding.js
// Simulate repeated funding operations to compare old vs new balance logic

function oldStep(balance, amount) {
  // Old behavior: update DB balance by adding amount (no rounding),
  // but the returned finalBalance used a loop adding amount/100 100 times starting from the previous balance.
  const updatedDbBalance = balance + amount; // DB update (no rounding)

  // Compute returned final per old code
  let final = balance; // previous balance
  for (let i = 0; i < 100; i++) {
    final = final + amount / 100;
  }

  return { updatedDbBalance, reportedFinal: final };
}

function newStep(balance, amount) {
  // New behavior: normalize amount to 2 decimals, round DB balance and new balance
  const rawAmount = Number(amount);
  const a = Number(rawAmount.toFixed(2));
  const currentBalance = Number(Number(balance).toFixed(2));
  const newBalance = Number((currentBalance + a).toFixed(2));
  return { updatedDbBalance: newBalance, reportedFinal: newBalance };
}

function centsStep(balanceCents, amountCents) {
  // Integer cents arithmetic for reference
  const newBalance = balanceCents + amountCents;
  return { updatedDbBalance: newBalance, reportedFinal: newBalance };
}

function runSimulation({ iterations = 10000, amount = 0.1 }) {
  console.log(`Running simulation: iterations=${iterations}, amount=${amount}`);

  let dbOld = 0.0;
  let lastReportedOld = 0.0;

  let dbNew = 0.0;
  let lastReportedNew = 0.0;

  let dbCents = 0;
  let lastReportedCents = 0;

  const amountCents = Math.round(amount * 100);

  for (let i = 0; i < iterations; i++) {
    // old
    const o = oldStep(dbOld, amount);
    dbOld = o.updatedDbBalance;
    lastReportedOld = o.reportedFinal;

    // new
    const n = newStep(dbNew, amount);
    dbNew = n.updatedDbBalance;
    lastReportedNew = n.reportedFinal;

    // cents
    const c = centsStep(dbCents, amountCents);
    dbCents = c.updatedDbBalance;
    lastReportedCents = c.reportedFinal;
  }

  console.log('\nResults after', iterations, 'fundings:');
  console.log('Old DB balance (float):', dbOld);
  console.log('Old reported final (float):', lastReportedOld);
  console.log('New DB balance (2-decimal):', dbNew);
  console.log('New reported final (2-decimal):', lastReportedNew);
  console.log('Cents DB balance (int cents):', dbCents, '->', (dbCents/100).toFixed(2));

  console.log('\nDifferences:');
  console.log('Old DB vs New DB:', (dbOld - dbNew));
  console.log('Old reported vs New reported:', (lastReportedOld - lastReportedNew));
  console.log('New DB vs Cents DB:', (Number(dbNew.toFixed(2)) - (dbCents/100)));
}

const args = process.argv.slice(2);
let iterations = 10000;
let amount = 0.1;
if (args.length >= 1) iterations = Number(args[0]);
if (args.length >= 2) amount = Number(args[1]);

runSimulation({ iterations, amount });
