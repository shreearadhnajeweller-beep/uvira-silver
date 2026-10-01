const fs = require('fs');
let appJs = fs.readFileSync('app.js', 'utf8');

// Replace DEFAULT_PRODUCTS array with Supabase init
const defaultProductsRegex = /\/\/ Initial Mock Product Catalog[\s\S]*?const DEFAULT_PRODUCTS = \[\s*[\s\S]*?\s*\];/;

const supabaseInit = `// Supabase Initialization
const SUPABASE_URL = 'https://kucxgktrcklojwzdcdbq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1Y3hna3RyY2tsb2p3emRjZGJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3ODM3MjksImV4cCI6MjA5NjM1OTcyOX0.81sgrfJLuOf9CG-JYx_TVt0LuXSdmo0_boufqoGRHYg';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const DEFAULT_PRODUCTS = []; // Now loaded from Supabase`;

appJs = appJs.replace(defaultProductsRegex, supabaseInit);

// Replace initState function signature and products load
const initStateRegex = /function initState\(\) \{[\s\S]*?\/\/ Cart Load/g;

const newInitState = `async function initState() {
    // Products Load from Supabase
    try {
        const { data, error } = await supabase.from('products').select('*');
        if (error) throw error;
        
        STATE.products = data.map(p => ({
            id: p.id,
            title: p.title,
            category: p.category,
            price: p.price,
            originalPrice: p.original_price,
            rating: parseFloat(p.rating),
            reviewsCount: p.reviews_count,
            plating: p.plating,
            inStock: p.in_stock,
            image: p.image,
            description: p.description,
            specs: p.specs
        }));
        localStorage.setItem("mrt_products_v3", JSON.stringify(STATE.products));
    } catch (err) {
        console.error("Error loading products from Supabase:", err);
        // Fallback to local storage if available
        const localProducts = localStorage.getItem("mrt_products_v3");
        if (localProducts) {
            STATE.products = JSON.parse(localProducts);
        } else {
            STATE.products = [];
        }
    }

    // Orders Load from Supabase
    try {
        const { data, error } = await supabase.from('orders').select('*');
        if (!error && data) {
            STATE.orders = data.map(o => ({
                id: o.id,
                date: o.date,
                customer: o.customer,
                phone: o.phone,
                address: o.address,
                paymentMethod: o.payment_method,
                subtotal: o.subtotal,
                discount: o.discount,
                total: o.total,
                status: o.status,
                items: o.items
            }));
            localStorage.setItem("mrt_orders", JSON.stringify(STATE.orders));
        }
    } catch (err) {
        console.error("Error loading orders from Supabase:", err);
    }

    // Cart Load`;

appJs = appJs.replace(initStateRegex, newInitState);

// Replace orders saving
const saveOrdersRegex = /function saveOrders\(\) \{\s*localStorage\.setItem\("mrt_orders", JSON\.stringify\(STATE\.orders\)\);\s*\}/g;
const newSaveOrders = `async function saveOrders(newOrder) {
    localStorage.setItem("mrt_orders", JSON.stringify(STATE.orders));
    if (newOrder) {
        try {
            await supabase.from('orders').insert([{
                id: newOrder.id,
                date: newOrder.date,
                customer: newOrder.customer,
                phone: newOrder.phone,
                address: newOrder.address,
                payment_method: newOrder.paymentMethod,
                subtotal: newOrder.subtotal,
                discount: newOrder.discount,
                total: newOrder.total,
                status: newOrder.status,
                items: newOrder.items
            }]);
        } catch (err) {
            console.error("Supabase order insert error:", err);
        }
    }
}`;

appJs = appJs.replace(saveOrdersRegex, newSaveOrders);

// Replace finalizeOrderPlacement where saveOrders is called
appJs = appJs.replace(/saveOrders\(\);/g, "saveOrders(newOrder);");

// Replace DOMContentLoaded to be async
const domLoadRegex = /window\.addEventListener\("DOMContentLoaded", \(\) => \{/g;
const newDomLoad = `window.addEventListener("DOMContentLoaded", async () => {`;
appJs = appJs.replace(domLoadRegex, newDomLoad);

const initCallRegex = /    initState\(\);/g;
const newInitCall = `    await initState();`;
appJs = appJs.replace(initCallRegex, newInitCall);

fs.writeFileSync('app.js', appJs);
console.log('app.js patched for Supabase!');
