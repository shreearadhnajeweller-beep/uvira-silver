const fs = require('fs');

// Patch index.html
let html = fs.readFileSync('index.html', 'utf8');

// Add orders to profile view
if (!html.includes('id="profile-orders-list"')) {
    const ordersHtml = `
        <!-- Orders List -->
        <div style="background-color: var(--color-silver-light); border-radius: var(--border-radius-md); padding: 30px; box-shadow: var(--shadow-lux); margin-top: 30px;">
            <h3 style="font-family: var(--font-heading); font-size: 1.5rem; color: var(--color-primary); margin-bottom: 20px; text-transform: uppercase;">My Orders</h3>
            <div id="profile-orders-list" style="display: flex; flex-direction: column; gap: 15px;">
                <!-- Filled by JS -->
            </div>
        </div>
    </div> <!-- Close profile-view -->`;
    
    // Replace the closing tag of profile-view
    // We will just find the last closing div of profile-view and replace it.
    // Let's replace the last </div> before <!-- --- C. ADMIN VIEW PANEL --- -->
    const adminIdx = html.indexOf('<!-- --- C. ADMIN VIEW PANEL --- -->');
    if (adminIdx !== -1) {
        const lastDivIdx = html.lastIndexOf('</div>', adminIdx - 1);
        if (lastDivIdx !== -1) {
            html = html.substring(0, lastDivIdx) + ordersHtml + html.substring(adminIdx);
        }
    }
}

// Fix the mangled Profile header if it was damaged
if (!html.includes('Digi Silver Section')) {
    html = html.replace(
        '<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 10px;">',
        `                <button onclick="handleLogout()" style="background: transparent; border: 1px solid var(--color-accent-pink); color: var(--color-accent-pink); padding: 8px 16px; border-radius: var(--border-radius-sm); font-weight: 600; cursor: pointer;">Logout</button>
            </div>
            <div style="display: grid; grid-template-columns: 1fr; gap: 20px;">
                <!-- Digi Silver Section -->
                <div style="background: #FFFFFF; border-radius: var(--border-radius-sm); padding: 25px; border: 1px solid var(--color-silver-mid);">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 10px;">`
    );
}

// Change "Free" to "100" in gift wrap label
html = html.replace('Add Premium Gift Wrap (Free)', 'Add Premium Gift Wrap (₹100)');
html = html.replace('Add Premium Gift Box (+₹99)', 'Add Premium Gift Wrap (₹100)');

fs.writeFileSync('index.html', html);


// Patch app.js
let js = fs.readFileSync('app.js', 'utf8');

// Gift Wrap Price
js = js.replace(/hasGiftWrap \? 99 : 0/g, 'hasGiftWrap ? 100 : 0');

// Orders UI function
const ordersJs = `
function updateProfileUI() {
    const balEl = document.getElementById('profile-digi-balance');
    const rateEl = document.getElementById('profile-silver-rate');
    const ordersList = document.getElementById('profile-orders-list');
    if (balEl && STATE.profile) {
        balEl.textContent = parseFloat(STATE.profile.digi_silver_balance).toFixed(2);
    }
    if (rateEl && STATE.rates) {
        rateEl.textContent = \`₹\${STATE.rates.sterling} / g\`;
    }
    if (ordersList && STATE.user) {
        const userOrders = STATE.orders.filter(o => o.customer.email === STATE.user.email);
        if (userOrders.length === 0) {
            ordersList.innerHTML = '<p style="color: var(--color-silver-dark);">You have no orders yet.</p>';
        } else {
            ordersList.innerHTML = userOrders.map(o => \`
                <div style="background: #fff; padding: 15px; border-radius: var(--border-radius-sm); border: 1px solid var(--color-silver-mid); display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-weight: bold; margin-bottom: 5px;">Order ID: \${o.id}</div>
                        <div style="font-size: 0.9rem; color: var(--color-silver-dark);">Date: \${o.date} | Total: ₹\${o.total}</div>
                    </div>
                    <div style="background-color: var(--color-primary); color: white; padding: 5px 10px; border-radius: 4px; font-size: 0.8rem; text-transform: uppercase;">
                        \${o.status || 'Pending'}
                    </div>
                </div>
            \`).join('');
        }
    }
}`;

// Replace updateProfileUI
const funcStart = js.indexOf('function updateProfileUI() {');
if (funcStart !== -1) {
    const nextFunc = js.indexOf('function openUserProfile() {', funcStart);
    js = js.substring(0, funcStart) + ordersJs + '\n\n' + js.substring(nextFunc);
}

fs.writeFileSync('app.js', js);
console.log('Patched correctly');
