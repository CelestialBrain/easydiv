
// Mocking the TW_SPACING_MAP for the test context
const TW_SPACING_MAP = {
    '0px': '0', '1px': 'px', '2px': '0.5', '4px': '1', '6px': '1.5', '8px': '2',
    '10px': '2.5', '12px': '3', '14px': '3.5', '16px': '4', '20px': '5', '24px': '6',
    '28px': '7', '32px': '8', '36px': '9', '40px': '10', '44px': '11', '48px': '12',
    '56px': '14', '64px': '16', '80px': '20', '96px': '24', '112px': '28', '128px': '32',
    '144px': '36', '160px': '40', '176px': '44', '192px': '48', '208px': '52', '224px': '56',
    '240px': '60', '256px': '64', '288px': '72', '320px': '80', '384px': '96'
};

// Parse map into a sorted array of numbers for nearest neighbor search
const TW_VALUES = Object.keys(TW_SPACING_MAP)
    .map(k => parseFloat(k))
    .sort((a, b) => a - b);

function pxToTw(val) {
    if (!val || val === '0px' || val === 'auto' || val === '0') return null;
    if (TW_SPACING_MAP[val]) return TW_SPACING_MAP[val];

    const isNegative = val.startsWith('-');
    const px = parseFloat(val);
    if (isNaN(px)) return `[${val}]`;

    const absPx = Math.abs(px);

    let closest = TW_VALUES[0];
    let minDiff = Math.abs(absPx - closest);

    for (let i = 1; i < TW_VALUES.length; i++) {
        const diff = Math.abs(absPx - TW_VALUES[i]);
        if (diff <= minDiff) { // Use <= to prefer larger value on ties (round up)
            minDiff = diff;
            closest = TW_VALUES[i];
        }
    }

    // Snap if within reasonable distance (e.g. 2.5px)
    let twValue;
    if (minDiff <= 2.5) {
        twValue = TW_SPACING_MAP[`${closest}px`];
    } else {
        twValue = `[${absPx}px]`;
    }

    return isNegative ? `-${twValue}` : twValue;
}

// --- TEST SUITE ---
const tests = [
    // Basic Rounding
    { input: '16px', expected: '4', desc: 'Exact match (16px -> 4)' },
    { input: '15px', expected: '4', desc: 'Rounding up (15px -> 16px -> 4)' },
    { input: '17px', expected: '4', desc: 'Rounding down (17px -> 16px -> 4)' },

    // Finer Granularity (2px / 0.125rem)
    { input: '2px', expected: '0.5', desc: 'Exact 2px -> 0.5' },
    { input: '2.4px', expected: '0.5', desc: 'Subpixel (2.4px -> 2px -> 0.5)' },
    { input: '3.5px', expected: '1', desc: 'Subpixel (3.5px -> 4px -> 1)' },
    { input: '6px', expected: '1.5', desc: 'Exact 6px -> 1.5' },
    { input: '7px', expected: '2', desc: 'Rounding (7px -> 8px -> 2)' },

    // Edge Cases
    { input: '-16px', expected: '-4', desc: 'Negative (-16px -> -4)' },
    { input: '-15px', expected: '-4', desc: 'Negative Rounding (-15px -> -4)' },
    { input: '0', expected: null, desc: 'String "0" -> null' },
    { input: '0px', expected: null, desc: 'String "0px" -> null' },

    // Fallbacks
    { input: '1000px', expected: '[1000px]', desc: 'Arbitrary fallback' },
];

console.log("Running Robust pxToTw Tests...\n");

let passed = 0;
tests.forEach(t => {
    const result = pxToTw(t.input);
    if (result === t.expected) {
        console.log(`✅ PASS: ${t.desc}`);
        passed++;
    } else {
        console.log(`❌ FAIL: ${t.desc}`);
        console.log(`   Expected: ${t.expected}, Got: ${result}`);
    }
});

console.log(`\nResults: ${passed}/${tests.length} passed.`);
