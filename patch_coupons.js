const fs = require('fs');
let js = fs.readFileSync('app.js', 'utf8');

// Replace Block 1 (around line 934) & Block 2 (around line 1051)
// These blocks have the 'labelSuffix' assignment.
js = js.replace(
    /if \(coupon\.type === 'free_silver'\) \{\s*discount = parseFloat\(coupon\.value \* STATE\.rates\.sterling\);\s*labelSuffix = `Free Silver: \$\{coupon\.value\}g`;\s*\} else \{\s*discount = parseFloat\(subtotal \* \(coupon\.value \/ 100\)\);\s*labelSuffix = `\$\{coupon\.value\}%`;\s*\}/g,
    `if (coupon.type === 'free_silver') {
                    discount = parseFloat(coupon.value * STATE.rates.sterling);
                    labelSuffix = \`Free Silver: \${coupon.value}g\`;
                } else if (coupon.type === 'fixed') {
                    discount = parseFloat(coupon.value);
                    labelSuffix = \`₹\${coupon.value}\`;
                } else {
                    discount = parseFloat(subtotal * (coupon.value / 100));
                    labelSuffix = \`\${coupon.value}%\`;
                }`
);

// We should also replace the non-parseFloat versions (around line 934)
js = js.replace(
    /if \(coupon\.type === 'free_silver'\) \{\s*discount = coupon\.value \* STATE\.rates\.sterling;\s*labelSuffix = `Free Silver: \$\{coupon\.value\}g`;\s*\} else \{\s*discount = subtotal \* \(coupon\.value \/ 100\);\s*labelSuffix = `\$\{coupon\.value\}%`;\s*\}/g,
    `if (coupon.type === 'free_silver') {
                discount = coupon.value * STATE.rates.sterling;
                labelSuffix = \`Free Silver: \${coupon.value}g\`;
            } else if (coupon.type === 'fixed') {
                discount = coupon.value;
                labelSuffix = \`₹\${coupon.value}\`;
            } else {
                discount = subtotal * (coupon.value / 100);
                labelSuffix = \`\${coupon.value}%\`;
            }`
);

// Replace Block 3 (around line 1231)
// This block does not have the 'labelSuffix' assignment.
js = js.replace(
    /if \(coupon\.type === 'free_silver'\) \{\s*discount = coupon\.value \* STATE\.rates\.sterling;\s*\} else \{\s*discount = subtotal \* \(coupon\.value \/ 100\);\s*\}/g,
    `if (coupon.type === 'free_silver') {
                discount = coupon.value * STATE.rates.sterling;
            } else if (coupon.type === 'fixed') {
                discount = coupon.value;
            } else {
                discount = subtotal * (coupon.value / 100);
            }`
);

fs.writeFileSync('app.js', js);
console.log("Patched successfully");
