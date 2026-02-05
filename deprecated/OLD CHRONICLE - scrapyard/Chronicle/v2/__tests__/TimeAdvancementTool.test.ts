// TimeAdvancementTool.test.ts - Test the time advancement tool
// =============================================================

import { createAdvanceTimeTool } from '../agent/tools.js';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`TEST FAILED: ${message}`);
}

async function run() {
  console.log('Starting Time Advancement Tool tests...');
  
  const mockRuntime = {
    getGTWG: () => ({
      metadata: {
        worldTime: '2024-12-31T23:00:00.000Z'
      }
    }),
    setGTWG: () => {},
    getLedger: () => ({}),
    setLedger: () => {},
    getTick: () => 0,
    projectPKG: async () => ({ pkg: {} }),
    queryGTWG: async () => ({}),
    queryPKG: async () => ({}),
    getConversation: async () => []
  };

  const advanceTimeTool = createAdvanceTimeTool(mockRuntime as any);

  try {
    // Test 1: Basic functionality - advance time by 60 minutes
    console.log('Testing basic time advancement...');
    const result1 = await advanceTimeTool.call({ minutes: 60 });
    
    assert(result1.success === true, 'Should succeed for valid input');
    assert(result1.timeAdvanced.minutes === 60, 'Should advance by 60 minutes');
    assert(result1.timeAdvanced.hours === 1, 'Should calculate 1 hour');
    assert(result1.timeAdvanced.remainingMinutes === 0, 'Should have no remaining minutes');
    assert(result1.patches.length === 1, 'Should generate 1 patch');
    assert(result1.patches[0].op === 'set', 'Patch should be set operation');
    assert(result1.patches[0].entity === '__meta__', 'Patch should target __meta__ entity');
    assert(result1.patches[0].field === 'worldTime', 'Patch should update worldTime field');
    assert(result1.patches[0].proposer === 'time_system', 'Patch should be from time_system');
    
    console.log('✅ Basic time advancement test passed');
  } catch (e) {
    console.error('Basic time advancement test failed:', e);
    throw e;
  }

  try {
    // Test 2: Partial hours
    console.log('Testing partial hours...');
    const result2 = await advanceTimeTool.call({ minutes: 90 });
    
    assert(result2.success === true, 'Should succeed for 90 minutes');
    assert(result2.timeAdvanced.minutes === 90, 'Should advance by 90 minutes');
    assert(result2.timeAdvanced.hours === 1, 'Should calculate 1 hour');
    assert(result2.timeAdvanced.remainingMinutes === 30, 'Should have 30 remaining minutes');
    
    console.log('✅ Partial hours test passed');
  } catch (e) {
    console.error('Partial hours test failed:', e);
    throw e;
  }

  try {
    // Test 3: Minutes only
    console.log('Testing minutes only...');
    const result3 = await advanceTimeTool.call({ minutes: 30 });
    
    assert(result3.success === true, 'Should succeed for 30 minutes');
    assert(result3.timeAdvanced.minutes === 30, 'Should advance by 30 minutes');
    assert(result3.timeAdvanced.hours === 0, 'Should calculate 0 hours');
    assert(result3.timeAdvanced.remainingMinutes === 30, 'Should have 30 remaining minutes');
    
    console.log('✅ Minutes only test passed');
  } catch (e) {
    console.error('Minutes only test failed:', e);
    throw e;
  }

  try {
    // Test 4: Input validation - negative minutes
    console.log('Testing input validation...');
    const result4 = await advanceTimeTool.call({ minutes: -10 });
    
    assert(result4.success === false, 'Should fail for negative minutes');
    assert(result4.error.includes('positive number'), 'Should have appropriate error message');
    assert(result4.patches.length === 0, 'Should generate no patches for invalid input');
    
    console.log('✅ Input validation test passed');
  } catch (e) {
    console.error('Input validation test failed:', e);
    throw e;
  }

  try {
    // Test 5: Input validation - zero minutes
    console.log('Testing zero minutes validation...');
    const result5 = await advanceTimeTool.call({ minutes: 0 });
    
    assert(result5.success === false, 'Should fail for zero minutes');
    assert(result5.error.includes('positive number'), 'Should have appropriate error message');
    
    console.log('✅ Zero minutes validation test passed');
  } catch (e) {
    console.error('Zero minutes validation test failed:', e);
    throw e;
  }

  try {
    // Test 6: Large duration (more than 24 hours) should succeed now
    console.log('Testing >24-hour duration...');
    const result6 = await advanceTimeTool.call({ minutes: 1500 }); // 25 hours
    
    assert(result6.success === true, 'Should succeed for more than 24 hours');
    assert(result6.timeAdvanced.minutes === 1500, 'Should advance by 1500 minutes');
    console.log('✅ >24-hour duration test passed');
  } catch (e) {
    console.error('>24-hour duration test failed:', e);
    throw e;
  }

  try {
    // Test 7: Exactly 24 hours still succeeds
    console.log('Testing exactly 24 hours...');
    const result7 = await advanceTimeTool.call({ minutes: 1440 }); // 24 hours
    
    assert(result7.success === true, 'Should succeed for exactly 24 hours');
    assert(result7.timeAdvanced.minutes === 1440, 'Should advance by 1440 minutes');
    assert(result7.timeAdvanced.hours === 24, 'Should calculate 24 hours');
    
    console.log('✅ Exactly 24 hours test passed');
  } catch (e) {
    console.error('Exactly 24 hours test failed:', e);
    throw e;
  }

  try {
    // Test 8: Patch generation with reason
    console.log('Testing patch generation...');
    const result8 = await advanceTimeTool.call({ minutes: 120, reason: 'Test waiting' });
    
    assert(result8.patches.length === 1, 'Should generate 1 patch');
    const patch = result8.patches[0];
    
    assert(patch.op === 'set', 'Patch should be set operation');
    assert(patch.entity === '__meta__', 'Patch should target __meta__ entity');
    assert(patch.field === 'worldTime', 'Patch should update worldTime field');
    assert(patch.proposer === 'time_system', 'Patch should be from time_system');
    assert(patch.metadata.reason === 'Test waiting', 'Patch should include custom reason');
    assert(patch.metadata.minutesAdvanced === 120, 'Patch should include minutes advanced');
    assert(patch.metadata.previousTime === result8.timeAdvanced.previousTime, 'Patch should include previous time');
    
    console.log('✅ Patch generation test passed');
  } catch (e) {
    console.error('Patch generation test failed:', e);
    throw e;
  }

  try {
    // Test 9: Default reason
    console.log('Testing default reason...');
    const result9 = await advanceTimeTool.call({ minutes: 60 });
    
    assert(result9.patches[0].metadata.reason === 'AI time advancement', 'Should use default reason');
    
    console.log('✅ Default reason test passed');
  } catch (e) {
    console.error('Default reason test failed:', e);
    throw e;
  }

  try {
    // Test 10: Time calculation accuracy
    console.log('Testing time calculation accuracy...');
    const before = (mockRuntime.getGTWG() as any).metadata.worldTime;
    const result10 = await advanceTimeTool.call({ minutes: 120 });
    
    const expectedNewDate = new Date(new Date(before).getTime() + 120 * 60 * 1000);
    
    assert(result10.timeAdvanced.newTime === expectedNewDate.toISOString(), 'Should calculate new time correctly');
    assert(result10.timeAdvanced.previousTime === before, 'Should preserve previous time');
    
    console.log('✅ Time calculation accuracy test passed');
  } catch (e) {
    console.error('Time calculation accuracy test failed:', e);
    throw e;
  }

  try {
    // Test 11: Narrative generation
    console.log('Testing narrative generation...');
    const result11 = await advanceTimeTool.call({ minutes: 120 });
    
    assert(result11.narrative.includes('2 hours'), 'Narrative should mention hours');
    assert(result11.narrative.includes('Time advances'), 'Narrative should mention time advancement');
    
    console.log('✅ Narrative generation test passed');
  } catch (e) {
    console.error('Narrative generation test failed:', e);
    throw e;
  }

  // New: rollover testing
  try {
    console.log('Testing day rollover...');
    const result = await advanceTimeTool.call({ duration: '2h' }); // from 23:00 +2h = next day 01:00
    const newDay = new Date(result.timeAdvanced.newTime).getUTCDate();
    const oldDay = new Date(result.timeAdvanced.previousTime).getUTCDate();
    assert(result.timeAdvanced.boundaries.day === (newDay !== oldDay), 'Day boundary should reflect rollover');
    console.log('✅ Day rollover test passed');
  } catch (e) { console.error('Day rollover test failed:', e); throw e; }

  try {
    console.log('Testing month rollover...');
    const result = await advanceTimeTool.call({ duration: '1d' }); // from Jan 1 after previous should roll month/year appropriately
    const newMonth = new Date(result.timeAdvanced.newTime).getUTCMonth();
    const oldMonth = new Date(result.timeAdvanced.previousTime).getUTCMonth();
    const newYear = new Date(result.timeAdvanced.newTime).getUTCFullYear();
    const oldYear = new Date(result.timeAdvanced.previousTime).getUTCFullYear();
    assert(result.timeAdvanced.boundaries.month === (newMonth !== oldMonth || newYear !== oldYear), 'Month boundary should reflect rollover');
    console.log('✅ Month rollover test passed');
  } catch (e) { console.error('Month rollover test failed:', e); throw e; }

  try {
    console.log('Testing structured duration parsing...');
    const result = await advanceTimeTool.call({ duration: '1d2h30m' });
    assert(result.success === true, 'Structured duration should be accepted');
    const minutes = result.timeAdvanced.minutes;
    assert(minutes === (1 * 24 * 60 + 2 * 60 + 30), 'Parsed minutes should match 1d2h30m');
    console.log('✅ Structured duration test passed');
  } catch (e) { console.error('Structured duration test failed:', e); throw e; }

  console.log('✅ All Time Advancement Rollover tests passed!');
}

run().catch((e) => {
  console.error('❌ Time Advancement Tool tests failed:', e);
  process.exit(1);
});
