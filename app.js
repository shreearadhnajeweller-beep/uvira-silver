
function seedMockProducts() {
    localStorage.setItem('mock_db_products', JSON.stringify([]));
    console.log("Cleared all products from local database.");
}
seedMockProducts();

function fixProductsImageSchema() {
    let products = JSON.parse(localStorage.getItem('mock_db_products') || '[]');
    let changed = false;
    products.forEach(p => {
        if (p.images && !p.image) {
            try {
                let imgs = JSON.parse(p.images);
                if (imgs && imgs.length > 0) {
                    p.image = imgs[0];
                    changed = true;
                }
            } catch (e) {}
        }
    });
    if (changed) {
        localStorage.setItem('mock_db_products', JSON.stringify(products));
        console.log("Fixed image schema in mock DB");
    }
}
fixProductsImageSchema();
 // Force run it once on reload

/**
 * UVIRA JEWELS - Application Logic
 * Implements SPA Router, Core State, Rate Simulator, Checkout, Cursive Previewer, 
 * Tracking Portal, and Full-Featured Administrative Panel.
 */

// Supabase Initialization
const SUPABASE_URL = "https://zimapfcyfxiqdnxaaonp.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InppbWFwZmN5ZnhpcWRueGFhb25wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMTE4NjEsImV4cCI6MjEwNDc4Nzg2MX0.n7UVMBY-5iBiaasKw34TkDdD04JgSTo9r7ombxXqnZk";
const supaClient = (window.supabase && window.supabase.createClient) 
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : {
      from: (table) => ({
          select: (cols) => ({
              then: (cb) => { 
                  let data = JSON.parse(localStorage.getItem('mock_db_' + table) || '[]');
                  cb({data, error: null}); 
                  return { catch: ()=>{} }; 
              },
              like: (col, val) => ({ then: (cb) => {
                  let data = JSON.parse(localStorage.getItem('mock_db_' + table) || '[]');
                  cb({data: data.filter(x => x[col] && String(x[col]).includes(val.replace('%',''))), error:null});
              } }),
              eq: (col, val) => ({
                  single: () => Promise.resolve({ data: JSON.parse(localStorage.getItem('mock_db_' + table) || '[]').find(x => x[col] === val) || null }),
                  then: (cb) => { 
                      let data = JSON.parse(localStorage.getItem('mock_db_' + table) || '[]');
                      cb({data: data.filter(x => x[col] === val), error:null});
                  }
              }),
              limit: (n) => Promise.resolve({ data: JSON.parse(localStorage.getItem('mock_db_' + table) || '[]').slice(0, n), error: null })
          }),
          insert: (arr) => {
              let data = JSON.parse(localStorage.getItem('mock_db_' + table) || '[]');
              data.push(...arr);
              localStorage.setItem('mock_db_' + table, JSON.stringify(data));
              return Promise.resolve({ error: null });
          },
          upsert: (arr) => {
              let data = JSON.parse(localStorage.getItem('mock_db_' + table) || '[]');
              arr.forEach(item => {
                  let idx = data.findIndex(x => x.id === item.id || x.key === item.key);
                  if (idx >= 0) data[idx] = item; else data.push(item);
              });
              localStorage.setItem('mock_db_' + table, JSON.stringify(data));
              return Promise.resolve({ error: null });
          },
          delete: () => ({ eq: (col, val) => {
              let data = JSON.parse(localStorage.getItem('mock_db_' + table) || '[]');
              data = data.filter(x => x[col] !== val);
              localStorage.setItem('mock_db_' + table, JSON.stringify(data));
              return Promise.resolve({ error: null });
          }})
      })
  };


const DEFAULT_PRODUCTS = []; // Now loaded from Supabase

// Global Application State
const STATE = {
    products: [],
    cart: [],
    wishlist: [],
    orders: [],
    rates: { sterling: 94.8, fine: 98.5, gold: 7500.00, trend: "up" },
    coupons: {
        "SILVER10": { code: "SILVER10", type: "percentage", value: 10, is_used: false, single_use: false },
        "SPARKLE15": { code: "SPARKLE15", type: "percentage", value: 15, is_used: false, single_use: false }
    },
    activeCoupon: null,
    currentView: "home",
    activeAdminTab: "dashboard",
    editingProductId: null,
    selectedSize: null,
    user: null,
    profile: null
};

function safeJSONParse(str, fallback) {
    try {
        if (typeof str !== 'string') return str;
        return JSON.parse(str);
    } catch (e) {
        return fallback;
    }
}

function getCustomerName(customer) {
    if (!customer) return "Guest";
    if (typeof customer === 'object') {
        return customer.name || "Guest";
    }
    if (typeof customer === 'string') {
        const parsed = safeJSONParse(customer, null);
        if (parsed && typeof parsed === 'object') {
            return parsed.name || customer;
        }
        return customer;
    }
    return "Guest";
}

// --- INITIALIZE APPLICATION STATE ---
async function initState() {
    initAuthListener();

    // Run all essential fetches in parallel for maximum speed
    const [productsResult, couponsResult, ratesResult] = await Promise.allSettled([
        supaClient.from('products').select('id,title,category,price,original_price,rating,reviews_count,plating,in_stock,image,description,specs'),
        supaClient.from('coupons').select('*'),
        supaClient.from('rates').select('*').limit(1)
    ]);

    // Products
    if (productsResult.status === 'fulfilled' && !productsResult.value.error) {
        const data = productsResult.value.data || [];
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
            gender: (p.specs && p.specs.gender) ? p.specs.gender : "both",
            specs: p.specs
        }));
    } else {
        console.error("Error loading products:", productsResult.reason || productsResult.value?.error);
        STATE.products = [];
    }

    // Coupons
    if (couponsResult.status === 'fulfilled' && !couponsResult.value.error) {
        const data = couponsResult.value.data || [];
        STATE.coupons = {};
        data.forEach(c => {
            STATE.coupons[c.code] = {
                code: c.code,
                type: c.type || 'percentage',
                value: c.value !== null && c.value !== undefined ? parseFloat(c.value) : (parseFloat(c.discount) || 0),
                is_used: !!c.is_used,
                single_use: !!c.single_use
            };
        });
    } else {
        console.error("Error loading coupons:", couponsResult.reason);
    }

    // Rates
    if (ratesResult.status === 'fulfilled' && !ratesResult.value.error) {
        const data = ratesResult.value.data || [];
        if (data.length > 0) {
            STATE.rates.sterling = parseFloat(data[0].sterling);
            STATE.rates.fine = parseFloat(data[0].fine);
            STATE.rates.gold = parseFloat(data[0].gold) || 7500.00;
            STATE.rates.trend = data[0].trend;
        }
    } else {
        console.error("Error loading rates:", ratesResult.reason);
    }

    recalculateAllProductPrices();

    // Cart & Wishlist from localStorage (instant)
    const localCart = localStorage.getItem("mrt_cart");
    if (localCart) STATE.cart = safeJSONParse(localCart, []);
    const localWishlist = localStorage.getItem("mrt_wishlist");
    if (localWishlist) STATE.wishlist = safeJSONParse(localWishlist, []);

    // Orders: load lazily in background — not needed for regular visitors
    supaClient.from('orders').select('*').then(({ data, error }) => {
        if (!error && data) {
            STATE.orders = data.map(o => ({
                id: o.id,
                date: o.date,
                customer: typeof o.customer === 'string' ? (o.customer.startsWith('{') ? safeJSONParse(o.customer, { name: o.customer }) : { name: o.customer }) : (o.customer || {}),
                phone: o.phone,
                address: o.address,
                paymentMethod: o.payment_method,
                subtotal: parseFloat(o.subtotal) || 0,
                discount: parseFloat(o.discount) || 0,
                total: parseFloat(o.total) || 0,
                status: o.status,
                items: typeof o.items === 'string' ? safeJSONParse(o.items, []) : (o.items || []),
                payment_screenshot: o.payment_screenshot
            }));
            updateHeaderCounters();
        }
    }).catch(err => console.error("Error loading orders:", err));

    // Admin Password default
    if (!localStorage.getItem("mrt_admin_password")) {
        localStorage.setItem("mrt_admin_password", "mrt925");
    }
}

// Save functions for state mutations
function saveCart() {
    localStorage.setItem("mrt_cart", JSON.stringify(STATE.cart));
    updateHeaderCounters();
}
function saveWishlist() {
    localStorage.setItem("mrt_wishlist", JSON.stringify(STATE.wishlist));
    updateHeaderCounters();
}
async function saveOrders(newOrder) {
    
    if (newOrder) {
        const basePayload = {
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
            items: newOrder.items,
            payment_screenshot: newOrder.payment_screenshot
        };
        
        try {
            // Try with GST fields
            const { error } = await supaClient.from('orders').insert([{
                ...basePayload,
                gst_amount: newOrder.gst_amount || 0,
                shipping: newOrder.shipping || 0,
                digi_subtotal: newOrder.digi_subtotal || 0
            }]);
            if (error) {
                // Fallback: insert without new columns if they don't exist yet
                console.warn("Insert with GST fields failed, retrying without:", error.message);
                await supaClient.from('orders').insert([basePayload]);
            }
        } catch (err) {
            console.error("Supabase order insert error:", err);
        }
    }
}

// Rate simulator is disabled to ensure metal rates are set by the admin manually.

// --- RENDER TICKER ---
function renderRatesTicker() {
    const tickerContainer = document.getElementById("rates-ticker");
    if (!tickerContainer) return;
    
    const sterlingStr = STATE.rates.sterling.toFixed(2);
    const fineStr = STATE.rates.fine.toFixed(2);
    const goldStr = (STATE.rates.gold || 7500.00).toFixed(2);
    const trendIcon = STATE.rates.trend === "up" ? "▲" : "▼";
    const trendClass = STATE.rates.trend === "up" ? "rate-up" : "rate-down";
    
    const totalOrders = 840 + (STATE.orders ? STATE.orders.length : 0);
    const announcementText = STATE.tickerCustomMessage || `✨ GET EXTRA 10% OFF ON YOUR FIRST SILVER ORDER! USE CODE: <strong style="color:var(--color-accent-pink);">SILVER10</strong> ✨`;

    const singleSet = `
        <div class="ticker-item">${announcementText}</div>
        <div class="ticker-item">🔴 LIVE METAL RATES: 925 Sterling Silver: <span class="ticker-rate">₹${sterlingStr}/g</span> <span class="${trendClass}">${trendIcon}</span> | 625 Silver: <span class="ticker-rate">₹${fineStr}/g</span> | 24K Gold: <span class="ticker-rate">₹${goldStr}/g</span></div>
        <div class="ticker-item">💍 100% NICKEL-FREE & LEAD-FREE HYPOALLERGENIC SILVER PIECES</div>
        <div class="ticker-item">🛍️ OVER ${totalOrders.toLocaleString('en-IN')} HAPPY ORDERS DELIVERED TILL DATE! 🛍️</div>
        <div class="ticker-item">⭐ FAST SECURE SHIPPING PAN INDIA ON ALL ORDERS!</div>
    `;
    
    tickerContainer.innerHTML = singleSet + singleSet;
}

// --- MOBILE NAV TOGGLE ---
function toggleMobileNav() {
    const navMenu = document.querySelector(".nav-menu");
    if (navMenu) {
        navMenu.classList.toggle("mobile-open");
    }
}

// --- SINGLE PAGE ROUTER ---
window.goBackFromDetail = function(e) {
    if (e) e.preventDefault();
    if (STATE.hasNavigated) {
        window.history.back();
    } else {
        navigateTo('shop');
    }
};
function navigateTo(viewId, preFilter = null, isPopstate = false) {
    // Close mobile nav if open
    const navMenu = document.querySelector(".nav-menu");
    if (navMenu && navMenu.classList.contains("mobile-open")) {
        navMenu.classList.remove("mobile-open");
    }
    
    if (viewId === "admin" && sessionStorage.getItem("mrt_admin_authenticated") !== "true") {
        alert("Access Denied: Please log in using the Admin Panel button.");
        viewId = "home";
    }
    
    // If navigating away from admin, clear authenticated session to enforce password check on return
    if (viewId !== "admin") {
        sessionStorage.removeItem("mrt_admin_authenticated");
        const btn = document.getElementById("admin-toggle");
        if (btn) btn.textContent = "Admin Panel";
    }

    if (!isPopstate) {
        STATE.hasNavigated = true;
        if (viewId === "detail" && STATE.selectedProduct) {
            history.pushState({ viewId, preFilter, selectedProductId: STATE.selectedProduct.id }, "", "#detail_" + STATE.selectedProduct.id);
        } else {
            history.pushState({ viewId, preFilter, selectedProductId: null }, "", "#" + viewId);
        }
    }
    
    STATE.currentView = viewId;
    
    // Deactivate all view panels
    const views = document.querySelectorAll(".app-view");
    views.forEach(v => v.classList.remove("active-view"));
    
    // Activate target
    const targetView = document.getElementById(`${viewId}-view`);
    if (targetView) targetView.classList.add("active-view");
    
    // Update Header active tab
    const navLinks = document.querySelectorAll(".nav-link");
    navLinks.forEach(link => {
        if (link.getAttribute("data-view") === viewId) {
            link.classList.add("active");
        } else {
            link.classList.remove("active");
        }
    });

    // Close drawers on navigate
    closeDrawer("cart");
    closeDrawer("wishlist");
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: "smooth" });

    // Handle view-specific renders
    if (viewId === "home") {
        renderHomeProducts();
    } else if (viewId === "shop") {
        if (preFilter) {
            applyQuickFilter(preFilter);
        } else {
            if (!isPopstate) {
                applyQuickFilter('all');
            } else {
                // If it's a back navigation and no preFilter was enforced, 
                // just re-render to retain whatever DOM checkboxes the user manually clicked.
                renderShopCatalog();
            }
        }
    } else if (viewId === "customisation") {
        renderCustomisationPage();
    } else if (viewId === "admin") {
        renderAdminDashboard();
    }
}

// --- RENDER COUNTERS ---
function updateHeaderCounters() {
    const cartCount = document.getElementById("cart-count");
    const wishlistCount = document.getElementById("wishlist-count");
    
    if (cartCount) {
        const totalItems = STATE.cart.reduce((sum, item) => sum + item.qty, 0);
        cartCount.textContent = totalItems;
        cartCount.style.display = totalItems > 0 ? "flex" : "none";
    }
    
    if (wishlistCount) {
        const totalWished = STATE.wishlist.length;
        wishlistCount.textContent = totalWished;
        wishlistCount.style.display = totalWished > 0 ? "flex" : "none";
    }
    
    const userOrderCountEl = document.getElementById("user-total-orders-count");
    if (userOrderCountEl && STATE.orders) {
        userOrderCountEl.textContent = `${STATE.orders.length.toLocaleString('en-IN')}+ Orders`;
    }
}

function handleSearchInput(event) {
    if (STATE.currentView !== 'shop') {
        navigateTo('shop', 'search');
    } else {
        renderShopCatalog();
    }
}

// --- SHOP PRE-FILTER LOGIC (Under 999, etc.) ---
function applyQuickFilter(filterType) {
    // Reset inputs
    const inStockInput = document.getElementById("filter-in-stock");
    if (inStockInput) inStockInput.checked = false;
    
    const genderAllRadio = document.getElementById("filter-gender-all");
    if (genderAllRadio) genderAllRadio.checked = true;
    
    const searchMainInput = document.getElementById("search-main");
    if (searchMainInput && filterType !== 'search') {
        searchMainInput.value = "";
    }
    
    // Reset category inputs
    const ringsInput = document.getElementById("filter-type-rings");
    if (ringsInput && filterType !== 'search') {
        const ids = [
            "filter-type-rings", "filter-type-earrings", "filter-type-pendants", 
            "filter-type-anklets", "filter-type-chains", "filter-type-chain_pendant",
            "filter-type-customised", "filter-type-kada", "filter-type-bracelet"
        ];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.checked = false;
        });
    }
    const priceMaxSlider = document.getElementById("filter-price-max");
    const priceDisplay = document.getElementById("filter-price-val");
    
    const categoriesList = ["whoop", "whoop_accessories", "rings", "earrings", "pendants", "anklets", "chains", "chain_pendant", "coins", "gold", "gold_coins", "kids", "customised", "kada", "bracelet", "bracelets"];
    
    if (filterType === "search") {
        // Keep current filters, just perform search
    } else if (filterType === "under-999") {
        priceMaxSlider.value = 999;
        priceDisplay.textContent = "₹999";
    } else if (filterType === "under-1999") {
        priceMaxSlider.value = 1999;
        priceDisplay.textContent = "₹1,999";
    } else if (filterType === "under-4999") {
        priceMaxSlider.value = 4999;
        priceDisplay.textContent = "₹4,999";
    } else if (filterType === "him") {
        priceMaxSlider.value = 50000;
        priceDisplay.textContent = "₹50,000+";
        const genderHimRadio = document.getElementById("filter-gender-him");
        if (genderHimRadio) genderHimRadio.checked = true;
    } else if (filterType === "her") {
        priceMaxSlider.value = 50000;
        priceDisplay.textContent = "₹50,000+";
        const genderHerRadio = document.getElementById("filter-gender-her");
        if (genderHerRadio) genderHerRadio.checked = true;
    } else if (categoriesList.includes(filterType)) {
        priceMaxSlider.value = 50000;
        priceDisplay.textContent = "₹50,000+";
        const cat = filterType === "bracelets" ? "bracelet" : filterType;
        const catCheckbox = document.getElementById(`filter-type-${cat}`);
        if (catCheckbox) catCheckbox.checked = true;
    } else if (filterType.startsWith("cat-")) {
        const cat = filterType.replace("cat-", "");
        priceMaxSlider.value = 50000;
        priceDisplay.textContent = "₹50,000+";
        // Pre-select sidebar categorization if matched (or let search handle it)
        document.getElementById("search-main").value = cat;
    } else {
        // Reset price slider and text display when clearing all filters
        priceMaxSlider.value = 50000;
        priceDisplay.textContent = "₹50,000+";
    }
    
    renderShopCatalog();
}

// --- RENDER PRODUCTS GRID (HOME) ---
function renderHomeProducts() {
    const bestSellersGrid = document.getElementById("best-sellers-grid");
    if (!bestSellersGrid) return;
    
    // Sort products by ratings / show top 4
    const sorted = [...STATE.products]
        .filter(p => p.id !== "prod-9") // Exclude pure coin from regular lists
        .sort((a,b) => b.rating - a.rating)
        .slice(0, 20);
        
    bestSellersGrid.innerHTML = sorted.map((p, idx) => createProductCardHtml(p, idx)).join("");
}

// --- RENDER DYNAMIC CATALOG (SHOP VIEW) ---
function renderShopCatalog() {
    const shopGrid = document.getElementById("shop-products-grid");
    const resultsCount = document.getElementById("results-count");
    if (!shopGrid) return;
    
    // Collect Filter Values
    const inStockOnly = document.getElementById("filter-in-stock") ? document.getElementById("filter-in-stock").checked : false;
    const maxPrice = document.getElementById("filter-price-max") ? parseFloat(document.getElementById("filter-price-max").value) : 50000;
    
    const categories = [];
    const ringsCheck = document.getElementById("filter-type-rings");
    if (ringsCheck && ringsCheck.checked) categories.push("rings");
    const earringsCheck = document.getElementById("filter-type-earrings");
    if (earringsCheck && earringsCheck.checked) categories.push("earrings");
    const pendantsCheck = document.getElementById("filter-type-pendants");
    if (pendantsCheck && pendantsCheck.checked) categories.push("pendants");
    const ankletsCheck = document.getElementById("filter-type-anklets");
    if (ankletsCheck && ankletsCheck.checked) categories.push("anklets");
    const chainsCheck = document.getElementById("filter-type-chains");
    if (chainsCheck && chainsCheck.checked) categories.push("chains");
    const chainPendantCheck = document.getElementById("filter-type-chain_pendant");
    if (chainPendantCheck && chainPendantCheck.checked) categories.push("chain_pendant");

    const customisedCheck = document.getElementById("filter-type-customised");
    if (customisedCheck && customisedCheck.checked) categories.push("customised");
    const kadaCheck = document.getElementById("filter-type-kada");
    if (kadaCheck && kadaCheck.checked) categories.push("kada");
    const braceletCheck = document.getElementById("filter-type-bracelet");
    if (braceletCheck && braceletCheck.checked) categories.push("bracelet");
    
    const searchQuery = document.getElementById("search-main") ? document.getElementById("search-main").value.toLowerCase().trim() : "";
    const sortBy = document.getElementById("shop-sort") ? document.getElementById("shop-sort").value : "popularity";
    
    let genderFilter = "all";
    const checkedGender = document.querySelector('input[name="filter-gender"]:checked');
    if (checkedGender) genderFilter = checkedGender.value;

    // Filter Pipeline
    let filtered = STATE.products.filter(p => {
        // Price Filter
        if (p.price > maxPrice) return false;
        
        // Stock Filter
        if (inStockOnly && !p.inStock) return false;
        
        // Gender Filter
        if (genderFilter !== "all") {
            const prodGender = (p.gender || (p.specs && p.specs.gender) || "both").toLowerCase();
            if (prodGender !== genderFilter) return false;
        }
        
        // Category Filter
        if (categories.length > 0 && !categories.includes(p.category)) return false;
        
        // Search Matching
        if (searchQuery) {
            const matchTitle = p.title ? p.title.toLowerCase().includes(searchQuery) : false;
            const matchDesc = p.description ? p.description.toLowerCase().includes(searchQuery) : false;
            const matchCat = p.category ? p.category.toLowerCase().includes(searchQuery) : false;
            const matchSpecs = p.specs ? Object.values(p.specs).some(val => val !== null && val !== undefined && String(val).toLowerCase().includes(searchQuery)) : false;
            if (!matchTitle && !matchDesc && !matchCat && !matchSpecs) return false;
        }
        
        return true;
    });
    
    // Sort Pipeline
    if (sortBy === "price-asc") {
        filtered.sort((a, b) => a.price - b.price);
    } else if (sortBy === "price-desc") {
        filtered.sort((a, b) => b.price - a.price);
    } else { // popularity rating
        filtered.sort((a, b) => b.rating - a.rating);
    }
    
    // Render
    resultsCount.textContent = `Showing ${filtered.length} products`;
    if (filtered.length === 0) {
        shopGrid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--color-silver-dark);">
                <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="margin-bottom:12px;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"></path></svg>
                <p style="font-weight:600;font-size:1.1rem;margin-bottom:4px;">No Silver Pieces Found</p>
                <p style="font-size:0.85rem;">Try relaxing your filters or adjusting your search term.</p>
            </div>
        `;
    } else {
        shopGrid.innerHTML = filtered.map((p, idx) => createProductCardHtml(p, idx)).join("");
    }
}

// Product Card HTML Generator
function createProductCardHtml(p, idx = 0) {
    const isWished = STATE.wishlist.includes(p.id) ? "wished" : "";
    const badgeHtml = !p.inStock 
        ? `<div class="product-card-badge" style="background-color:#94A3B8;">OUT OF STOCK</div>` 
        : (p.price < p.originalPrice ? `<div class="product-card-badge">SALE</div>` : "");
        
    const discountPercent = p.originalPrice && p.originalPrice > p.price 
        ? Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100) 
        : 0;
    
    return `
        <div class="product-card animate-entrance" style="animation-delay: ${idx * 0.05}s;">
            ${badgeHtml}
            <button class="product-card-wish ${isWished}" onclick="event.stopPropagation(); toggleWishlist('${p.id}');" aria-label="Add to Wishlist">
                <svg width="18" height="18" fill="${isWished ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
            </button>
            <div class="product-img-wrap" onclick="viewProductDetail('${p.id}')">
                <img class="product-img" src="${p.image}" alt="${p.title}" loading="lazy">
            </div>
            <div class="product-info">

                <h3 class="product-title" onclick="viewProductDetail('${p.id}')">${p.title}</h3>
                <div class="product-metadata-row" style="display: flex; gap: 8px; font-size: 0.75rem; color: var(--color-silver-dark); margin-top: 4px; margin-bottom: 8px; align-items: center; justify-content: center;">
                    <span style="display: flex; align-items: center; gap: 2px;">⚖️ ${p.specs && p.specs.weight ? p.specs.weight : 'N/A'}</span>
                    <span>•</span>
                    <span style="display: flex; align-items: center; gap: 2px;">👥 ${p.gender === 'him' ? 'Men' : (p.gender === 'her' ? 'Women' : (p.gender === 'kids' ? 'Kids' : 'Unisex'))}</span>
                </div>
                <div class="product-price-row">
                    <span class="product-price">₹${p.price.toLocaleString("en-IN")}</span>
                    ${p.originalPrice ? `<span class="product-original-price">₹${p.originalPrice.toLocaleString("en-IN")}</span>` : ""}
                    ${discountPercent > 0 ? `<span class="product-discount">${discountPercent}% OFF</span>` : ""}
                </div>
                <button class="product-btn-add" onclick="addToCart('${p.id}')" ${!p.inStock ? 'disabled style="border-color:#94A3B8;color:#94A3B8;"' : ''}>
                    ${p.inStock ? 'Add to Cart' : 'Sold Out'}
                </button>
            </div>
        </div>
    `;
}

// --- WISH LIST INTERACTIONS ---
function toggleWishlist(prodId) {
    const idx = STATE.wishlist.indexOf(prodId);
    if (idx === -1) {
        STATE.wishlist.push(prodId);
    } else {
        STATE.wishlist.splice(idx, 1);
    }
    saveWishlist();
    
    // Immediate grid rerenders
    if (STATE.currentView === "home") renderHomeProducts();
    if (STATE.currentView === "shop") renderShopCatalog();
}

// --- CART ACTIONS ---
function addToCart(prodId, count = 1) {
    const prod = STATE.products.find(p => p.id === prodId);
    if (!prod || !prod.inStock) return;
    
    // Determine the size to add
    let size = null;
    const isToeRing = prod.title.toLowerCase().includes("toe");
    const isEarring = (prod.category || "").toLowerCase() === "earrings" || prod.title.toLowerCase().includes("earring");
    const isRing = ((prod.category || "").toLowerCase() === "rings" || prod.title.toLowerCase().includes("ring") || prod.title.toLowerCase().includes("band")) && !isToeRing && !isEarring;
    const isChain = (prod.category || "").toLowerCase().includes("chain");
    const isKada = (prod.category || "").toLowerCase() === "kada" || prod.title.toLowerCase().includes("kada");
    const isBracelet = (prod.category || "").toLowerCase() === "bracelet" || prod.title.toLowerCase().includes("bracelet");
    
    if (STATE.selectedProduct && STATE.selectedProduct.id === prod.id && STATE.selectedSize) {
        // If we are adding the product that is currently viewed in detail, use the selected size!
        size = STATE.selectedSize;
    } else {
        if (prod.specs && prod.specs.available_sizes) {
            const parts = prod.specs.available_sizes.split(',').map(s => s.trim()).filter(s => s.length > 0);
            if (parts.length > 0) {
                size = parts[0];
            }
        }
        if (!size) {
            // Otherwise, use the category default size
            if (isToeRing) {
                size = "Adjustable";
            } else if (isRing) {
                size = "13"; // Default Indian Ring Size
            } else if (isChain) {
                size = "18 Inches"; // Default Chain length
            } else if (isKada) {
                size = "2.4";
            } else if (isBracelet) {
                size = "7 Inches";
            }
        }
    }
    
    const giftWrapCheck = document.getElementById("detail-gift-wrap");
    const giftMessageEl = document.getElementById("detail-gift-message");
    // Only apply gift wrap if adding the currently viewed product in details and checked
    const hasGiftWrap = STATE.selectedProduct && STATE.selectedProduct.id === prod.id && giftWrapCheck && giftWrapCheck.checked;
    
    let wrapSuffix = "";
    if (hasGiftWrap) {
        wrapSuffix = " + Gift Box";
        const msg = giftMessageEl ? giftMessageEl.value.trim().substring(0, 300) : "";
        if (msg) wrapSuffix += ` [Msg: ${msg}]`;
    }
    
    const sizeSuffix = size ? ` (Size: ${size})` : "";
    const cartTitle = `${prod.title}${sizeSuffix}${wrapSuffix}`;
    
    const unitPrice = prod.price + (hasGiftWrap ? 100 : 0);
    
    const existing = STATE.cart.find(item => item.title === cartTitle);
    if (existing) {
        existing.qty += count;
    } else {
        STATE.cart.push({
            id: prod.id,
            title: cartTitle,
            price: unitPrice,
            image: prod.image,
            qty: count
        });
    }
    saveCart();
    showDrawer("cart");
}

function updateCartQty(cartTitle, change) {
    const existing = STATE.cart.find(item => item.title === cartTitle);
    if (existing) {
        existing.qty += change;
        if (existing.qty <= 0) {
            const idx = STATE.cart.indexOf(existing);
            STATE.cart.splice(idx, 1);
        }
        saveCart();
        renderCartDrawer();
    }
}

// Helper to format category names for UI display
function formatCategoryName(cat) {
    if (!cat) return "";
    const lower = cat.toLowerCase();
    if (lower === "chains") return "Chains";
    if (lower === "chain_pendant") return "Chain with Pendant";
    if (lower === "rings") return "Rings";
    if (lower === "earrings") return "Earrings";
    if (lower === "pendants") return "Pendants";
    if (lower === "anklets") return "Anklets & Toe Rings";
    if (lower === "customised") return "Customised";
    if (lower === "kada") return "Kadas";
    if (lower === "bracelet") return "Bracelets";
    return cat.charAt(0).toUpperCase() + cat.slice(1);
}

// --- DETAIL VIEW ENGINE ---
function viewProductDetail(prodId, isPopstate = false) {
    const prod = STATE.products.find(p => p.id === prodId);
    if (!prod) return;
    
    STATE.selectedProduct = prod;
    navigateTo("detail", null, isPopstate);
    
    const mainImg = document.getElementById("detail-main-img");
    const category = document.getElementById("detail-category");
    const title = document.getElementById("detail-title");
    const stars = document.getElementById("detail-stars-val");
    const reviews = document.getElementById("detail-reviews-val");
    const price = document.getElementById("detail-price");
    const originalPrice = document.getElementById("detail-orig-price");
    const discount = document.getElementById("detail-discount-percent");
    const desc = document.getElementById("detail-desc");
    const thumbs = document.getElementById("detail-thumbs");
    
    const specMetal = document.getElementById("spec-metal");
    const specWeight = document.getElementById("spec-weight");
    const specPlating = document.getElementById("spec-plating");
    const specAuth = document.getElementById("spec-auth");
    const specGender = document.getElementById("spec-gender");
    
    const quantityVal = document.getElementById("qty-val");
    const addCartBtn = document.getElementById("detail-add-cart-btn");
    const buyNowBtn = document.getElementById("detail-buy-now-btn");
    const whatsappBtn = document.getElementById("detail-whatsapp-btn");
    
    // Reset quantity counter
    if (quantityVal) quantityVal.textContent = "1";
    
    // Reset gift wrap selection
    const giftWrapCheck = document.getElementById("detail-gift-wrap");
    if (giftWrapCheck) giftWrapCheck.checked = false;
    
    // Ring, Toe Ring, and Chain Size rendering
    const isToeRing = prod.title.toLowerCase().includes("toe");
    const isEarring = (prod.category || "").toLowerCase() === "earrings" || prod.title.toLowerCase().includes("earring");
    const isRing = ((prod.category || "").toLowerCase() === "rings" || prod.title.toLowerCase().includes("ring") || prod.title.toLowerCase().includes("band")) && !isToeRing && !isEarring;
    const isChain = (prod.category || "").toLowerCase().includes("chain");
    const isKada = (prod.category || "").toLowerCase() === "kada" || prod.title.toLowerCase().includes("kada");
    const isBracelet = (prod.category || "").toLowerCase() === "bracelet" || prod.title.toLowerCase().includes("bracelet");
    
    const sizeSection = document.getElementById("detail-size-section");
    const sizeLabel = sizeSection ? sizeSection.querySelector(".custom-form-label") : null;
    
    if (sizeSection) {
        if (isRing || isToeRing || isChain || isKada) {
            sizeSection.style.display = "block";
            let sizes = [];
            let labelText = "Select Size";
            let hasCustomSizes = false;
            
            if (prod.specs && prod.specs.available_sizes) {
                const parts = prod.specs.available_sizes.split(',').map(s => s.trim()).filter(s => s.length > 0);
                if (parts.length > 0) {
                    sizes = parts;
                    labelText = "SELECT SIZE / VARIANT";
                    hasCustomSizes = true;
                }
            }
            
            if (!hasCustomSizes) {
                if (isToeRing) {
                    sizes = ["Adjustable"];
                    labelText = "SELECT SIZE / VARIANT";
                } else if (isRing) {
                    sizes = Array.from({ length: 19 }, (_, i) => (10 + i).toString());
                    labelText = "SELECT SIZE / VARIANT";
                } else if (isChain) {
                    sizes = ["16 Inches", "18 Inches", "20 Inches"];
                    labelText = "SELECT SIZE / VARIANT";
                } else if (isKada) {
                    sizes = ["2.4", "2.6", "2.8", "Adjustable"];
                    labelText = "SELECT SIZE / VARIANT";
                } else if (isBracelet) {
                    sizes = ["6.5 Inches", "7 Inches", "7.5 Inches", "Adjustable"];
                    labelText = "SELECT SIZE / VARIANT";
                }
            }
            
            if (sizeLabel) {
                sizeLabel.textContent = labelText;
            }
            
            STATE.selectedSize = sizes[0];
            
            const selectedText = document.getElementById("selected-size-text");
            if (selectedText) {
                selectedText.textContent = STATE.selectedSize;
            }

            const modalOptions = document.getElementById("size-selector-modal-options");
            if (modalOptions) {
                modalOptions.innerHTML = sizes.map((size) => {
                    const isActive = STATE.selectedSize === size;
                    return `
                        <div class="size-option-circle ${isActive ? 'active-size' : ''}" style="width: 100%; height: 42px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; cursor: pointer; border: 1px solid var(--color-silver-mid); transition: all 0.2s ease; user-select: none;" onclick="selectProductSize('${size}', this)">${size}</div>
                    `;
                }).join("");
            }
        } else {
            sizeSection.style.display = "none";
            STATE.selectedSize = null;
        }
    }
    
    // Bind Details
    if (mainImg) mainImg.src = prod.image;
    if (category) category.textContent = formatCategoryName(prod.category).toUpperCase();
    if (title) title.textContent = prod.title;
    if (stars) stars.textContent = prod.rating.toFixed(1);
    // Reviews removed per client request
    if (price) price.textContent = `₹${prod.price.toLocaleString("en-IN")}`;
    
    if (originalPrice) {
        if (prod.originalPrice) {
            originalPrice.style.display = "inline";
            originalPrice.textContent = `₹${prod.originalPrice.toLocaleString("en-IN")}`;
        } else {
            originalPrice.style.display = "none";
        }
    }
    
    if (discount) {
        if (prod.originalPrice) {
            const percent = Math.round(((prod.originalPrice - prod.price) / prod.originalPrice) * 100);
            discount.style.display = "inline";
            discount.textContent = `${percent}% OFF`;
        } else {
            discount.style.display = "none";
        }
    }
    
    if (desc) desc.textContent = prod.description;
    
    // Bind Specs
    if (specMetal) specMetal.textContent = prod.specs.metal || "925 Sterling Silver";
    if (specWeight) specWeight.textContent = prod.specs.weight || "N/A";
    if (specAuth) specAuth.textContent = prod.specs.authenticity || "92.5 Hallmark Certificate Included";
    if (specGender) specGender.textContent = prod.gender === "him" ? "Men" : (prod.gender === "her" ? "Women" : (prod.gender === "kids" ? "Kids" : "Unisex"));
    
    // Thumbnail strip
    if (thumbs) {
        thumbs.innerHTML = `
            <div class="detail-thumb active-thumb" onclick="changeDetailImage('${prod.image}', this)"><img src="${prod.image}" alt=""></div>
        `;
    }
    
    // In Stock Actions
    if (addCartBtn) {
        if (prod.inStock) {
            addCartBtn.disabled = false;
            addCartBtn.textContent = "Add to Cart";
            addCartBtn.style.borderColor = "var(--color-accent-pink)";
            addCartBtn.style.color = "var(--color-accent-pink)";
        } else {
            addCartBtn.disabled = true;
            addCartBtn.textContent = "Sold Out";
            addCartBtn.style.borderColor = "#94A3B8";
            addCartBtn.style.color = "#94A3B8";
        }
    }
    if (buyNowBtn) {
        if (prod.inStock) {
            buyNowBtn.disabled = false;
            buyNowBtn.textContent = "Buy Now";
            buyNowBtn.style.backgroundColor = "var(--color-accent-pink)";
            buyNowBtn.style.boxShadow = "0 4px 15px rgba(208, 92, 107, 0.25)";
            buyNowBtn.style.pointerEvents = "auto";
        } else {
            buyNowBtn.disabled = true;
            buyNowBtn.textContent = "Sold Out";
            buyNowBtn.style.backgroundColor = "#94A3B8";
            buyNowBtn.style.boxShadow = "none";
            buyNowBtn.style.pointerEvents = "none";
        }
    }
    
    // WhatsApp Buy Trigger
    if (whatsappBtn) {
        whatsappBtn.onclick = () => {
            const qty = parseInt(document.getElementById("qty-val").textContent);
            
            const isBase64 = prod.image && prod.image.startsWith("data:");
            const photoUrl = isBase64 ? "[Custom Design Uploaded]" : prod.image;
            
            const text = encodeURIComponent(`Hello UVIRA JEWELS! I am interested in purchasing the following item:\n\n*Product:* ${prod.title}\n*Price:* ₹${prod.price}\n*Quantity:* ${qty}\n*Metal specs:* ${prod.specs.metal}.\n*Product Photo:* ${photoUrl}\n\nPlease let me know availability and billing details!`);
            window.open(`https://api.whatsapp.com/send?phone=919825098250&text=${text}`, "_blank");
        };
    }
}

function changeDetailImage(src, element) {
    const mainImg = document.getElementById("detail-main-img");
    if (mainImg) mainImg.src = src;
    
    const thumbs = document.querySelectorAll(".detail-thumb");
    thumbs.forEach(t => t.classList.remove("active-thumb"));
    element.classList.add("active-thumb");
}

function adjustDetailQty(val) {
    const qtyVal = document.getElementById("qty-val");
    if (qtyVal) {
        let current = parseInt(qtyVal.textContent);
        current = Math.max(1, current + val);
        qtyVal.textContent = current;
    }
}

function triggerAddSelectedToCart() {
    if (STATE.selectedProduct) {
        const qtyVal = document.getElementById("qty-val");
        const count = qtyVal ? parseInt(qtyVal.textContent) : 1;
        addToCart(STATE.selectedProduct.id, count);
    }
}

function selectProductSize(size, element) {
    try {
        console.log("Selected size:", size);
        STATE.selectedSize = size;
        if (element && element.parentNode) {
            const siblings = element.parentNode.querySelectorAll(".size-option-circle");
            siblings.forEach(s => s.classList.remove("active-size"));
            element.classList.add("active-size");
            console.log("Active class applied to:", element);
        }
        const selectedText = document.getElementById("selected-size-text");
        if (selectedText) {
            selectedText.textContent = size;
        }
        setTimeout(() => {
            closeSizeSelectorModal();
        }, 150);
    } catch (err) {
        console.error("Error in selectProductSize:", err);
    }
}

function triggerBuyNow() {
    if (STATE.selectedProduct) {
        const qtyVal = document.getElementById("qty-val");
        const count = qtyVal ? parseInt(qtyVal.textContent) : 1;
        
        const prod = STATE.selectedProduct;
        if (!prod || !prod.inStock) return;
        
        const giftWrapCheck = document.getElementById("detail-gift-wrap");
        const giftMessageEl = document.getElementById("detail-gift-message");
        const hasGiftWrap = giftWrapCheck && giftWrapCheck.checked;
        
        let wrapSuffix = "";
        if (hasGiftWrap) {
            wrapSuffix = " + Gift Box";
            const msg = giftMessageEl ? giftMessageEl.value.trim().substring(0, 300) : "";
            if (msg) wrapSuffix += ` [Msg: ${msg}]`;
        }
        
        const isToeRing = prod.title.toLowerCase().includes("toe");
        const isEarring = (prod.category || "").toLowerCase() === "earrings" || prod.title.toLowerCase().includes("earring");
        const isRing = ((prod.category || "").toLowerCase() === "rings" || prod.title.toLowerCase().includes("ring") || prod.title.toLowerCase().includes("band")) && !isToeRing && !isEarring;
        const isChain = (prod.category || "").toLowerCase().includes("chain");
        const isKada = (prod.category || "").toLowerCase() === "kada" || prod.title.toLowerCase().includes("kada");
        const isBracelet = (prod.category || "").toLowerCase() === "bracelet" || prod.title.toLowerCase().includes("bracelet");
        
        let size = STATE.selectedSize;
        if (!size) {
            if (prod.specs && prod.specs.available_sizes) {
                const parts = prod.specs.available_sizes.split(',').map(s => s.trim()).filter(s => s.length > 0);
                if (parts.length > 0) {
                    size = parts[0];
                }
            }
            if (!size) {
                if (isToeRing) size = "Adjustable";
                else if (isRing) size = "13";
                else if (isChain) size = "18 Inches";
                else if (isKada) size = "2.4";
                else if (isBracelet) size = "7 Inches";
            }
        }
        
        const sizeSuffix = size ? ` (Size: ${size})` : "";
        const cartTitle = `${prod.title}${sizeSuffix}${wrapSuffix}`;
        
        const unitPrice = prod.price + (hasGiftWrap ? 100 : 0);
        
        const existing = STATE.cart.find(item => item.title === cartTitle);
        if (existing) {
            existing.qty = count;
        } else {
            STATE.cart.push({
                id: prod.id,
                title: cartTitle,
                price: unitPrice,
                image: prod.image,
                qty: count
            });
        }
        saveCart();
        checkoutCart();
    }
}



// --- CART & WISHLIST DRAWERS DISPLAY ---
function showDrawer(type) {
    const drawer = document.getElementById(`${type}-drawer`);
    const overlay = document.getElementById("drawer-overlay");
    
    if (drawer && overlay) {
        drawer.classList.add("drawer-open");
        overlay.classList.add("overlay-open");
        
        if (type === "cart") renderCartDrawer();
        if (type === "wishlist") renderWishlistDrawer();
    }
}

function closeDrawer(type) {
    const drawer = document.getElementById(`${type}-drawer`);
    const overlay = document.getElementById("drawer-overlay");
    
    if (drawer) drawer.classList.remove("drawer-open");
    if (overlay && !document.querySelector(".drawer.drawer-open")) {
        overlay.classList.remove("overlay-open");
    }
}

function renderCartDrawer() {
    const cartContainer = document.getElementById("cart-drawer-items");
    const summarySubtotal = document.getElementById("cart-subtotal");
    const summaryDiscountRow = document.getElementById("cart-discount-row");
    const summaryDiscount = document.getElementById("cart-discount");
    const summaryTotal = document.getElementById("cart-total");
    
    if (!cartContainer) return;
    
    if (STATE.cart.length === 0) {
        cartContainer.innerHTML = `
            <div class="drawer-empty-state">
                <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"></path></svg>
                <p style="font-weight:600;">Your shopping cart is empty</p>
                <p style="font-size:0.8rem;margin-top:4px;">Add sparkly 925 silver pieces to make it happy!</p>
            </div>
        `;
        if (summarySubtotal) summarySubtotal.textContent = "₹0";
        if (summaryDiscountRow) summaryDiscountRow.style.display = "none";
        if (summaryTotal) summaryTotal.textContent = "₹0";
        return;
    }
    
    cartContainer.innerHTML = STATE.cart.map((item, idx) => `
        <div class="drawer-item" style="animation-delay: ${idx * 0.05}s;">
            <img class="drawer-item-img" src="${item.image}" alt="">
            <div class="drawer-item-details">
                <div class="drawer-item-title">${item.title}</div>
                <div class="drawer-item-price-row">
                    <span class="drawer-item-price">₹${item.price.toLocaleString("en-IN")}</span>
                </div>
                <div class="drawer-item-qty-row">
                    <button class="qty-btn" style="padding: 2px 8px; font-size: 0.85rem;" onclick="updateCartQty('${item.title.replace(/'/g, "\\'")}', -1)">-</button>
                    <span class="drawer-item-qty">${item.qty}</span>
                    <button class="qty-btn" style="padding: 2px 8px; font-size: 0.85rem;" onclick="updateCartQty('${item.title.replace(/'/g, "\\'")}', 1)">+</button>
                </div>
            </div>
            <button class="drawer-item-remove" onclick="updateCartQty('${item.title.replace(/'/g, "\\'")}', -${item.qty})">Remove</button>
        </div>
    `).join("");
    
    // Calculates
    const subtotal = STATE.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    let discount = 0;
    
    if (STATE.activeCoupon) {
        const coupon = STATE.coupons[STATE.activeCoupon];
        if (coupon) {
            let labelSuffix = "";
            if (coupon.type === 'free_silver') {
                discount = coupon.value * STATE.rates.sterling;
                labelSuffix = `Free Silver: ${coupon.value}g`;
            } else if (coupon.type === 'fixed') {
                discount = coupon.value;
                labelSuffix = `₹${coupon.value}`;
            } else {
                discount = subtotal * (coupon.value / 100);
                labelSuffix = `${coupon.value}%`;
            }
            discount = Math.min(discount, subtotal);
            if (summaryDiscountRow) {
                summaryDiscountRow.style.display = "flex";
                summaryDiscount.textContent = `-₹${discount.toLocaleString("en-IN")} (${labelSuffix})`;
            }
        }
    } else {
        if (summaryDiscountRow) summaryDiscountRow.style.display = "none";
    }
    
    const total = subtotal - discount;
    
    if (summarySubtotal) summarySubtotal.textContent = `₹${subtotal.toLocaleString("en-IN")}`;
    if (summaryTotal) summaryTotal.textContent = `₹${total.toLocaleString("en-IN")}`;
}

function applyCouponCode() {
    const input = document.getElementById("cart-coupon-input");
    if (!input) return;
    
    const code = input.value.toUpperCase().trim();
    const coupon = STATE.coupons[code];
    if (coupon) {
        if (coupon.is_used) {
            alert("This coupon has already been used and can only be used once.");
            return;
        }
        STATE.activeCoupon = code;
        alert(`Success! Coupon "${code}" applied successfully.`);
        renderCartDrawer();
    } else {
        alert("Invalid coupon code. Try 'SILVER10' or check with customer support!");
        STATE.activeCoupon = null;
        renderCartDrawer();
    }
}

function checkoutCart() {
    if (STATE.cart.length === 0) return;
    if (!STATE.user) {
        alert("Please login to proceed with checkout.");
        const cartDrawer = document.getElementById('cart-drawer');
        const drawerOverlay = document.getElementById('drawer-overlay');
        if (cartDrawer) cartDrawer.classList.remove('drawer-open');
        if (drawerOverlay) drawerOverlay.classList.remove('overlay-open');
        document.getElementById('auth-overlay').style.display = 'block';
        document.getElementById('auth-modal').style.display = 'block';
        return;
    }
    openCheckoutModal();
}

function openCheckoutModal() {
    const modal = document.getElementById("checkout-modal");
    const overlay = document.getElementById("checkout-modal-overlay");
    if (modal && overlay) {
        // Pre-fill fields if we have stored values
        const nameInp = document.getElementById("checkout-name");
        const phoneInp = document.getElementById("checkout-phone");
        
        const flatInp = document.getElementById("checkout-flat");
        const streetInp = document.getElementById("checkout-street");
        const landmarkInp = document.getElementById("checkout-landmark");
        const cityInp = document.getElementById("checkout-city");
        const stateInp = document.getElementById("checkout-state");
        const pincodeInp = document.getElementById("checkout-pincode");
        
        if (nameInp) nameInp.value = localStorage.getItem("mrt_checkout_name") || "";
        if (phoneInp) phoneInp.value = localStorage.getItem("mrt_checkout_phone") || "";
        if (flatInp) flatInp.value = localStorage.getItem("mrt_checkout_flat") || "";
        if (streetInp) streetInp.value = localStorage.getItem("mrt_checkout_street") || "";
        if (landmarkInp) landmarkInp.value = localStorage.getItem("mrt_checkout_landmark") || "";
        if (cityInp) cityInp.value = localStorage.getItem("mrt_checkout_city") || "";
        if (stateInp) stateInp.value = localStorage.getItem("mrt_checkout_state") || "";
        if (pincodeInp) pincodeInp.value = localStorage.getItem("mrt_checkout_pincode") || "";
        
        const checkoutCouponInp = document.getElementById("checkout-coupon-input");
        if (checkoutCouponInp) checkoutCouponInp.value = STATE.activeCoupon || "";
        
        // Reset radio buttons and UPI subfield on open
        const upiRadio = document.querySelector('input[name="checkout-payment"][value="UPI"]');
        if (upiRadio) upiRadio.checked = true;
        
        const upiSubfields = document.getElementById("checkout-upi-subfields");
        if (upiSubfields) upiSubfields.style.display = "none";
        
        const upiIdInp = document.getElementById("checkout-upi-id");
        if (upiIdInp) upiIdInp.value = "";
        
        // Render Order Summary
        const summaryItemsContainer = document.getElementById("checkout-summary-items");
        if (summaryItemsContainer) {
            summaryItemsContainer.innerHTML = STATE.cart.map(item => `
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.85rem;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <img src="${item.image}" alt="" style="width: 36px; height: 36px; object-fit: cover; border-radius: 4px; border: 1px solid var(--color-silver-mid);">
                        <div>
                            <div style="font-weight: 600; color: var(--color-primary); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.title}">${item.title}</div>
                            <div style="font-size: 0.72rem; color: var(--color-silver-dark);">Qty: ${item.qty}</div>
                        </div>
                    </div>
                    <span style="font-weight: 600; color: var(--color-primary);">₹${(item.price * item.qty).toLocaleString("en-IN")}</span>
                </div>
            `).join("");
        }
        
        let digiSubtotal = 0;
        let physicalSubtotal = 0;
        STATE.cart.forEach(item => {
            const isDigi = item.isDigiSilver || (item.title && item.title.toLowerCase().includes('digi silver'));
            if (isDigi) digiSubtotal += (item.price * item.qty);
            else physicalSubtotal += (item.price * item.qty);
        });
        const subtotal = digiSubtotal + physicalSubtotal;
        let discount = 0;
        
        const summarySubtotal = document.getElementById("checkout-summary-subtotal");
        const summaryDiscountRow = document.getElementById("checkout-summary-discount-row");
        const summaryDiscount = document.getElementById("checkout-summary-discount");
        const summaryGst = document.getElementById("checkout-summary-gst");
        const summaryTotal = document.getElementById("checkout-summary-total");
        
        if (STATE.activeCoupon) {
            const coupon = STATE.coupons[STATE.activeCoupon];
            if (coupon) {
                let labelSuffix = "";
                if (coupon.type === 'free_silver') {
                    discount = parseFloat(coupon.value * STATE.rates.sterling);
                    labelSuffix = `Free Silver: ${coupon.value}g`;
                } else if (coupon.type === 'fixed') {
                    discount = parseFloat(coupon.value);
                    labelSuffix = `₹${coupon.value}`;
                } else {
                    discount = parseFloat(subtotal * (coupon.value / 100));
                    labelSuffix = `${coupon.value}%`;
                }
                discount = Math.min(discount, subtotal);
                if (summaryDiscountRow && summaryDiscount) {
                    summaryDiscountRow.style.display = "flex";
                    summaryDiscount.textContent = `-₹${Math.round(discount).toLocaleString("en-IN")} (${labelSuffix})`;
                }
            }
        } else {
            if (summaryDiscountRow) summaryDiscountRow.style.display = "none";
        }
        
        const hasPhysicalItems = physicalSubtotal > 0;
        const shippingFee = hasPhysicalItems ? 150 : 0;
        
        // Digi Silver: 3% GST is EXTRA (added on top)
        // Physical items: 3% GST is INCLUDED in price
        const digiGst = Math.round(digiSubtotal * 0.03);
        const physicalGst = Math.round((physicalSubtotal - Math.min(discount, physicalSubtotal)) * 0.03);
        const total = subtotal - discount + shippingFee + digiGst;
        
        const gstLabel = document.getElementById("checkout-summary-gst-label");
        if (gstLabel) {
            if (digiSubtotal > 0 && physicalSubtotal === 0) {
                gstLabel.textContent = "GST (3% Extra):";
            } else if (digiSubtotal > 0 && physicalSubtotal > 0) {
                gstLabel.textContent = "GST (3% Extra on Digi):";
            } else {
                gstLabel.textContent = "GST (3% Included):";
            }
        }
        
        // Display: for digi-only show digiGst, for physical-only show physicalGst, for mixed show digiGst (extra part)
        const displayGst = digiSubtotal > 0 ? digiGst : physicalGst;
        
        const shippingEl = document.getElementById("checkout-summary-shipping");
        if (shippingEl) {
            if (shippingFee === 0 && physicalSubtotal === 0 && digiSubtotal > 0) {
                shippingEl.innerHTML = `<span style="text-decoration: line-through; color: var(--color-silver-dark); margin-right: 6px;">₹150</span>₹0`;
            } else {
                shippingEl.textContent = `₹${shippingFee.toLocaleString("en-IN")}`;
            }
        }
        
        if (summarySubtotal) summarySubtotal.textContent = `₹${subtotal.toLocaleString("en-IN")}`;
        if (summaryGst) summaryGst.textContent = `₹${Math.round(displayGst).toLocaleString("en-IN")}`;
        if (summaryTotal) summaryTotal.textContent = `₹${Math.round(total).toLocaleString("en-IN")}`;

        modal.style.display = "block";
        overlay.style.display = "block";
        
        if (nameInp) {
            setTimeout(() => nameInp.focus(), 50);
        }
    }
}

function closeCheckoutModal() {
    const modal = document.getElementById("checkout-modal");
    const overlay = document.getElementById("checkout-modal-overlay");
    if (modal && overlay) {
        modal.style.display = "none";
        overlay.style.display = "none";
    }
}

function applyCheckoutCouponCode() {
    const input = document.getElementById("checkout-coupon-input");
    if (!input) return;
    
    const code = input.value.toUpperCase().trim();
    const coupon = STATE.coupons[code];
    if (coupon) {
        if (coupon.is_used) {
            alert("This coupon has already been used and can only be used once.");
            return;
        }
        STATE.activeCoupon = code;
        alert(`Success! Coupon "${code}" applied successfully.`);
        openCheckoutModal();
        renderCartDrawer();
    } else {
        alert("Invalid coupon code. Try 'SILVER10' or check with customer support!");
        STATE.activeCoupon = null;
        openCheckoutModal();
        renderCartDrawer();
    }
}

function togglePaymentFields(method) {
    const ssFields = document.getElementById("checkout-payment-ss-fields");
    const waNote = document.getElementById("checkout-wa-note");
    if (ssFields) ssFields.style.display = method === "UPI" ? "block" : "none";
    if (waNote) waNote.style.display = method === "WhatsApp" ? "block" : "none";
    // Clear screenshot when switching to WhatsApp
    if (method === "WhatsApp") {
        checkoutPaymentSsBase64 = "";
        const ssInput = document.getElementById("checkout-payment-ss");
        if (ssInput) ssInput.value = "";
        const previewWrap = document.getElementById("checkout-payment-ss-preview-wrap");
        if (previewWrap) previewWrap.style.display = "none";
    }
}

function submitCheckoutOrder() {
    if (STATE.cart.length === 0) {
        alert("Your shopping cart is empty!");
        closeCheckoutModal();
        return;
    }
    const nameInp = document.getElementById("checkout-name");
    const phoneInp = document.getElementById("checkout-phone");
    
    const flatInp = document.getElementById("checkout-flat");
    const streetInp = document.getElementById("checkout-street");
    const landmarkInp = document.getElementById("checkout-landmark");
    const cityInp = document.getElementById("checkout-city");
    const stateInp = document.getElementById("checkout-state");
    const pincodeInp = document.getElementById("checkout-pincode");
    
    if (!nameInp || !phoneInp || !flatInp || !streetInp || !landmarkInp || !cityInp || !stateInp || !pincodeInp) return;
    
    const name = nameInp.value.trim();
    const phone = phoneInp.value.trim();
    const flat = flatInp.value.trim();
    const street = streetInp.value.trim();
    const landmark = landmarkInp.value.trim();
    const city = cityInp.value.trim();
    const state = stateInp.value;
    const pincode = pincodeInp.value.trim();
    
    if (!name || name.length < 3) {
        alert("Please enter your full name (minimum 3 characters).");
        nameInp.focus();
        return;
    }
    const phoneRegex = /^(?:\+91|0)?[6-9]\d{9}$/;
    if (!phoneRegex.test(phone.replace(/\s+/g, ""))) {
        alert("Please enter a valid 10-digit mobile number (e.g. 98765 43210).");
        phoneInp.focus();
        return;
    }
    if (!flat) {
        alert("Please enter your Flat / House No / Apartment details.");
        flatInp.focus();
        return;
    }
    if (!street) {
        alert("Please enter your Street / Area / Sector details.");
        streetInp.focus();
        return;
    }
    if (!city) {
        alert("Please enter your Town or City.");
        cityInp.focus();
        return;
    }
    if (!pincode) {
        alert("Please enter your Pincode.");
        pincodeInp.focus();
        return;
    }
    const pincodeRegex = /^\d{6}$/;
    if (!pincodeRegex.test(pincode)) {
        alert("Please enter a valid 6-digit Pincode.");
        pincodeInp.focus();
        return;
    }
    if (!state) {
        alert("Please select your State.");
        stateInp.focus();
        return;
    }
    
    // Combine fields into formatted address
    const address = `${flat}, ${street}${landmark ? ', ' + landmark : ''}, ${city}, ${state} - ${pincode}`;
    
    // Save to localStorage for future pre-filling
    localStorage.setItem("mrt_checkout_name", name);
    localStorage.setItem("mrt_checkout_phone", phone);
    localStorage.setItem("mrt_checkout_flat", flat);
    localStorage.setItem("mrt_checkout_street", street);
    localStorage.setItem("mrt_checkout_landmark", landmark);
    localStorage.setItem("mrt_checkout_city", city);
    localStorage.setItem("mrt_checkout_state", state);
    localStorage.setItem("mrt_checkout_pincode", pincode);
    
    const paymentRadio = document.querySelector('input[name="checkout-payment"]:checked');
    const paymentMethod = paymentRadio ? paymentRadio.value : "UPI";
    
    // Screenshot required ONLY for UPI payment
    if (paymentMethod === "UPI" && !checkoutPaymentSsBase64) {
        alert("Please upload your UPI payment screenshot to complete checkout.");
        return;
    }
    
    const orderId = `UVR-SLV-${Math.floor(1000 + Math.random() * 9000)}`;
    let digiSubtotal = 0;
    let physicalSubtotal = 0;
    STATE.cart.forEach(item => {
        const isDigi = item.isDigiSilver || (item.title && item.title.toLowerCase().includes('digi silver'));
        if (isDigi) digiSubtotal += (item.price * item.qty);
        else physicalSubtotal += (item.price * item.qty);
    });
    const subtotal = digiSubtotal + physicalSubtotal;
    
    let discount = 0;
    if (STATE.activeCoupon) {
        const coupon = STATE.coupons[STATE.activeCoupon];
        if (coupon) {
            if (coupon.type === 'free_silver') {
                discount = coupon.value * STATE.rates.sterling;
            } else if (coupon.type === 'fixed') {
                discount = coupon.value;
            } else {
                discount = subtotal * (coupon.value / 100);
            }
            discount = Math.min(discount, subtotal);
        }
    }
    
    const hasPhysicalItems = physicalSubtotal > 0;
    const shippingFee = hasPhysicalItems ? 150 : 0;
    const digiGst = Math.round(digiSubtotal * 0.03);
    const total = subtotal - discount + shippingFee + digiGst;
    
    // WhatsApp orders go straight to placed; UPI orders need admin approval
    const orderStatus = paymentMethod === "WhatsApp" ? "placed" : "awaiting_approval";
    
    const customerData = {
        name: name,
        email: STATE.user ? STATE.user.email : null,
        token: STATE.user ? STATE.user.token : null
    };
    
    const newOrder = {
        id: orderId,
        date: new Date().toISOString().split("T")[0],
        customer: JSON.stringify(customerData),
        phone: phone,
        address: address,
        paymentMethod: paymentMethod === "WhatsApp" ? "WhatsApp" : "UPI",
        items: JSON.stringify([...STATE.cart]),
        subtotal: subtotal,
        discount: discount,
        total: total,
        gst_amount: digiGst,
        shipping: shippingFee,
        digi_subtotal: digiSubtotal,
        status: orderStatus,
        payment_screenshot: paymentMethod === "UPI" ? checkoutPaymentSsBase64 : null
    };
    
    // Call finalizeOrderPlacement directly since verification is manual
    finalizeOrderPlacement(newOrder, orderId);
}

let checkoutPaymentSsBase64 = "";

function previewPaymentScreenshot(input) {
    const previewWrap = document.getElementById("checkout-payment-ss-preview-wrap");
    const previewImg = document.getElementById("checkout-payment-ss-preview");
    if (!previewWrap || !previewImg) return;
    
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            checkoutPaymentSsBase64 = e.target.result;
            previewImg.src = e.target.result;
            previewWrap.style.display = "block";
        };
        reader.readAsDataURL(input.files[0]);
    } else {
        checkoutPaymentSsBase64 = "";
        previewImg.src = "";
        previewWrap.style.display = "none";
    }
}

let CURRENT_SUCCESS_ORDER_ID = "";

function closeOrderSuccessModal() {
    const overlay = document.getElementById("order-success-overlay");
    const modal = document.getElementById("order-success-modal");
    if (overlay && modal) {
        overlay.style.display = "none";
        modal.style.display = "none";
    }
}

function handleSuccessTrack() {
    closeOrderSuccessModal();
    navigateTo("track");
    const trackInput = document.getElementById("track-order-id-input");
    if (trackInput) {
        trackInput.value = CURRENT_SUCCESS_ORDER_ID;
        lookupOrderStatus();
    }
}

function finalizeOrderPlacement(newOrder, orderId) {
    const mappedOrder = {
        id: newOrder.id,
        date: newOrder.date,
        customer: typeof newOrder.customer === 'string' ? safeJSONParse(newOrder.customer, { name: newOrder.customer }) : (newOrder.customer || {}),
        phone: newOrder.phone,
        address: newOrder.address,
        paymentMethod: newOrder.paymentMethod,
        subtotal: parseFloat(newOrder.subtotal) || 0,
        discount: parseFloat(newOrder.discount) || 0,
        total: parseFloat(newOrder.total) || 0,
        status: newOrder.status,
        items: typeof newOrder.items === 'string' ? safeJSONParse(newOrder.items, []) : (newOrder.items || []),
        payment_screenshot: newOrder.payment_screenshot
    };
    STATE.orders.push(mappedOrder);
    saveOrders(newOrder);
    
    // Decrement stock for purchased items
    if (Array.isArray(mappedOrder.items)) {
        mappedOrder.items.forEach(async (cartItem) => {
            if (!cartItem || !cartItem.id) return;
            const pIdx = STATE.products.findIndex(p => p.id === cartItem.id);
            if (pIdx !== -1) {
                const prod = STATE.products[pIdx];
                let currentQty = (prod.specs && prod.specs.stock_qty !== undefined) ? prod.specs.stock_qty : 10;
                let newQty = Math.max(0, currentQty - (cartItem.qty || 1));
                
                prod.specs = {
                    ...(prod.specs || {}),
                    stock_qty: newQty
                };
                if (newQty <= 0) {
                    prod.inStock = false;
                }
                
                // Save to database
                const dbProduct = {
                    id: prod.id,
                    title: prod.title,
                    category: prod.category,
                    price: prod.price,
                    original_price: prod.originalPrice,
                    rating: prod.rating,
                    reviews_count: prod.reviewsCount,
                    plating: prod.plating,
                    in_stock: prod.inStock,
                    image: prod.image,
                    description: prod.description,
                    specs: prod.specs
                };
                
                try {
                    await supaClient.from('products').upsert([dbProduct]);
                } catch (dbErr) {
                    console.error("Failed to update product stock in DB:", dbErr);
                }
            }
        });
    }
    
    // Mark coupon as used if single use
    if (STATE.activeCoupon) {
        const couponCode = STATE.activeCoupon;
        const coupon = STATE.coupons[couponCode];
        if (coupon && coupon.single_use) {
            coupon.is_used = true;
            supaClient.from('coupons')
                .update({ is_used: true })
                .eq('code', couponCode)
                .then()
                .catch(err => console.error("Error marking coupon as used in DB:", err));
        }
    }
    
    // Empty Cart
    STATE.cart = [];
    STATE.activeCoupon = null;
    const couponInp = document.getElementById("cart-coupon-input");
    if (couponInp) couponInp.value = "";
    saveCart();
    
    closeCheckoutModal();
    closeDrawer("cart");
    
    // Reset payment SS
    checkoutPaymentSsBase64 = "";
    const ssInp = document.getElementById("checkout-payment-ss");
    if (ssInp) ssInp.value = "";
    const ssPrevWrap = document.getElementById("checkout-payment-ss-preview-wrap");
    if (ssPrevWrap) ssPrevWrap.style.display = "none";
    
    // Show user order success modal instead of native alert
    CURRENT_SUCCESS_ORDER_ID = orderId;
    const successIdDisplay = document.getElementById("success-order-id");
    if (successIdDisplay) successIdDisplay.textContent = orderId;
    
    const successTitle = document.getElementById("order-success-title");
    const successDesc = document.getElementById("order-success-desc");
    if (newOrder.status === "awaiting_approval") {
        if (successTitle) successTitle.textContent = "Verification Pending!";
        if (successDesc) successDesc.textContent = "Your order details and payment screenshot have been submitted. Once our admin approves the payment, your order will be confirmed and processed.";
    } else {
        if (successTitle) successTitle.textContent = "Order Confirmed!";
        if (successDesc) successDesc.textContent = "Thank you for shopping with us. Your order has been securely registered and is being processed by our master artisans.";
    }
    
    const overlay = document.getElementById("order-success-overlay");
    const modal = document.getElementById("order-success-modal");
    if (overlay && modal) {
        overlay.style.display = "block";
        modal.style.display = "block";
    }
    
    // Redirect to WhatsApp if WhatsApp Order method was selected
    if (newOrder.paymentMethod.startsWith("WhatsApp Order")) {
        let itemsText = "";
        newOrder.items.forEach((item, idx) => {
            const isBase64 = item.image && item.image.startsWith("data:");
            const photoUrl = isBase64 ? "[Custom Design Uploaded]" : item.image;
            itemsText += `${idx + 1}. *Product:* ${item.title}\n   *Price:* ₹${item.price.toLocaleString("en-IN")}\n   *Quantity:* ${item.qty}\n   *Product Photo:* ${photoUrl}\n\n`;
        });
        
        const text = encodeURIComponent(`Hello UVIRA JEWELS! I have placed an order and uploaded my payment screenshot:\n\n*Order ID:* ${orderId}\n*Customer Name:* ${newOrder.customer}\n*Phone:* ${newOrder.phone}\n*Shipping Address:* ${newOrder.address}\n\n*Order Items:*\n${itemsText}*Shipping Fee:* ₹150\n*Grand Total:* ₹${newOrder.total.toLocaleString("en-IN")}\n\nPlease verify my payment screenshot and confirm my order!`);
        
        window.open(`https://api.whatsapp.com/send?phone=919825098250&text=${text}`, "_blank");
    }
}

function renderWishlistDrawer() {
    const container = document.getElementById("wishlist-drawer-items");
    if (!container) return;
    
    if (STATE.wishlist.length === 0) {
        container.innerHTML = `
            <div class="drawer-empty-state">
                <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"></path></svg>
                <p style="font-weight:600;">Your wishlist is empty</p>
                <p style="font-size:0.8rem;margin-top:4px;">Tap the heart on items you love to save them here.</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = STATE.wishlist.map(id => {
        const p = STATE.products.find(item => item.id === id);
        if (!p) return "";
        
        return `
            <div class="drawer-item" style="align-items: center;">
                <img class="drawer-item-img" src="${p.image}" alt="">
                <div class="drawer-item-details">
                    <div class="drawer-item-title" style="margin-bottom:2px;">${p.title}</div>
                    <span class="drawer-item-price">₹${p.price.toLocaleString("en-IN")}</span>
                    <button class="product-btn-add" style="margin-top:8px; padding:6px 0;" onclick="addToCart('${p.id}'); toggleWishlist('${p.id}');">Add & Remove</button>
                </div>
                <button class="drawer-item-remove" onclick="toggleWishlist('${p.id}'); renderWishlistDrawer();">Remove</button>
            </div>
        `;
    }).join("");
}

// --- TRACK ORDER PORTAL LOOKUP ---
function lookupOrderStatus() {
    const input = document.getElementById("track-order-id-input");
    const resultsWrap = document.getElementById("track-results");
    if (!input || !resultsWrap) return;
    
    const searchId = input.value.trim().toUpperCase();
    if (!searchId) {
        alert("Please enter a valid Order ID.");
        return;
    }
    
    const order = STATE.orders.find(o => o.id.toUpperCase() === searchId);
    if (!order) {
        alert(`No order found matching "${searchId}". Please check the ID or try again.`);
        resultsWrap.style.display = "none";
        return;
    }
    
    // Display Track Results
    resultsWrap.style.display = "block";
    
    const displayId = document.getElementById("order-id-display");
    const displayDate = document.getElementById("order-date-display");
    
    if (displayId) displayId.textContent = order.id;
    if (displayDate) displayDate.textContent = `Order placed on: ${order.date} | Customer: ${order.customer} | Payment Mode: ${order.paymentMethod || order.payment_method || "COD"}`;
    
    // Setup Timeline Nodes based on Status: placed, processing, dispatched, delivered
    const steps = ["placed", "processing", "dispatched", "delivered"];
    const currentIdx = steps.indexOf(order.status);
    
    const timelineNodes = document.querySelectorAll(".timeline-step");
    timelineNodes.forEach((node, idx) => {
        node.className = "timeline-step"; // clear
        
        if (idx < currentIdx) {
            node.classList.add("step-completed");
        } else if (idx === currentIdx) {
            if (order.status === "delivered") {
                node.classList.add("step-completed");
            } else {
                node.classList.add("step-active");
            }
        }
    });
}

// --- ADMINISTRATIVE DASHBOARD CONTROLLER ---
function navigateAdminTab(tabId) {
    STATE.activeAdminTab = tabId;
    
    const tabs = document.querySelectorAll(".admin-tab-view");
    tabs.forEach(t => t.classList.remove("active-tab"));
    
    const activeTab = document.getElementById(`admin-tab-${tabId}`);
    if (activeTab) activeTab.classList.add("active-tab");
    
    const menuItems = document.querySelectorAll(".admin-side-menu-item");
    menuItems.forEach(item => {
        if (item.getAttribute("data-tab") === tabId) {
            item.classList.add("active-menu-item");
        } else {
            item.classList.remove("active-menu-item");
        }
    });
    
    if (tabId === "dashboard") renderAdminDashboard();
    if (tabId === "rates") renderAdminRates();
    if (tabId === "orders") renderAdminOrders();
    if (tabId === "inventory") renderAdminInventoryList();
    if (tabId === "gst") renderAdminGstPortal();
    if (tabId === "coupons") loadAdminCoupons();
    if (tabId === "users") loadAdminUsers();
    if (tabId === "tds") renderAdminTdsReport();
    if (tabId === "settings") {
        const curPass = document.getElementById("admin-current-password");
        const newPass = document.getElementById("admin-new-password");
        if (curPass) curPass.value = "";
        if (newPass) newPass.value = "";
    }
}

async function loadAdminUsers() {
    const tbody = document.getElementById("admin-users-tbody");
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px;">Loading users...</td></tr>';
    
    const searchInp = document.getElementById("admin-users-search");
    if (searchInp) searchInp.value = "";
    
    try {
        const { data, error } = await supaClient.from('settings').select('*').like('key', 'user_%');
        if (error) throw error;
        
        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px;">No registered users found</td></tr>';
            return;
        }
        
        const users = data.map(row => {
            let record = {};
            try {
                record = JSON.parse(row.value);
                if (!record || typeof record !== 'object') {
                    record = {};
                }
            } catch (e) {
                record = {};
            }
            const commissions = Array.isArray(record.referral_commissions) ? record.referral_commissions : [];
            return {
                email: record.email || row.key.replace('user_', ''),
                name: record.name || 'N/A',
                balance: parseFloat(record.digi_silver_balance) || 0,
                referral_code: record.referral_code || 'N/A',
                referred_by: record.referred_by || 'None',
                referral_commissions: commissions,
                aadhar: record.aadhar || '',
                aadhar_status: record.aadhar_status || 'not_submitted',
                aadhar_front_data: record.aadhar_front_data || '',
                aadhar_back_data: record.aadhar_back_data || '',
                pan: record.pan || '',
                pan_status: record.pan_status || 'not_submitted'
            };
        });
        
        users.forEach(u => {
            u.friends_referred = users.filter(x => x.referred_by === u.referral_code).length;
            u.total_earned = u.referral_commissions.reduce((sum, c) => sum + (parseFloat(c.commission_amount) || 0), 0);
        });
        
        users.sort((a, b) => b.balance - a.balance);
        
        STATE.adminUsers = users;
        
        renderUsersTable(users);
    } catch (err) {
        console.error("Error loading admin users:", err);
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: red;">Failed to load users: ${err.message}</td></tr>`;
    }
}

function renderUsersTable(users) {
    const tbody = document.getElementById("admin-users-tbody");
    if (!tbody) return;
    
    tbody.innerHTML = users.map(u => {
        // Aadhar KYC display
        let aadharHtml = '';
        if (u.aadhar_status === 'approved') {
            aadharHtml = `Num: <strong>${u.aadhar}</strong><br><span class="admin-status-badge" style="background:#D1FAE5;color:#065F46;padding:2px 6px;border-radius:4px;font-size:0.75rem;font-weight:bold;">Approved</span>`;
        } else if (u.aadhar_status === 'pending_approval') {
            aadharHtml = `Num: <strong>${u.aadhar}</strong><br><span class="admin-status-badge" style="background:#FEF3C7;color:#92400E;padding:2px 6px;border-radius:4px;font-size:0.75rem;font-weight:bold;margin-bottom:4px;display:inline-block;">Pending Approval</span><br>
            <a href="#" onclick="viewKycDoc('${u.email.replace(/'/g, "\\'")}', 'front'); return false;" style="font-size:0.75rem;color:var(--color-accent-pink);text-decoration:underline;margin-right:8px;font-weight:bold;">Front Doc</a>
            <a href="#" onclick="viewKycDoc('${u.email.replace(/'/g, "\\'")}', 'back'); return false;" style="font-size:0.75rem;color:var(--color-accent-pink);text-decoration:underline;font-weight:bold;">Back Doc</a>`;
        } else {
            aadharHtml = `<span class="admin-status-badge" style="background:#F3F4F6;color:#374151;padding:2px 6px;border-radius:4px;font-size:0.75rem;">Not Submitted</span>`;
        }

        // PAN KYC display
        let panHtml = '';
        if (u.pan_status === 'approved') {
            panHtml = `Num: <strong>${u.pan}</strong><br><span class="admin-status-badge" style="background:#D1FAE5;color:#065F46;padding:2px 6px;border-radius:4px;font-size:0.75rem;font-weight:bold;">Approved</span>`;
        } else if (u.pan_status === 'pending_approval') {
            panHtml = `Num: <strong>${u.pan}</strong><br><span class="admin-status-badge" style="background:#FEF3C7;color:#92400E;padding:2px 6px;border-radius:4px;font-size:0.75rem;font-weight:bold;">Pending Approval</span>`;
        } else {
            panHtml = `<span class="admin-status-badge" style="background:#F3F4F6;color:#374151;padding:2px 6px;border-radius:4px;font-size:0.75rem;">Not Submitted</span>`;
        }

        // Admin actions
        let actionsHtml = '';
        if (u.aadhar_status === 'pending_approval') {
            actionsHtml += `<button onclick="approveAadhar('${u.email.replace(/'/g, "\\'")}')" style="padding: 4px 8px; font-size: 0.68rem; margin-top: 0; background: #10B981; color: #FFFFFF; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 5px; width: 100%; display: block;">Approve Aadhar</button>`;
        }
        if (u.pan_status === 'pending_approval') {
            actionsHtml += `<button onclick="approvePan('${u.email.replace(/'/g, "\\'")}')" style="padding: 4px 8px; font-size: 0.68rem; margin-top: 0; background: #10B981; color: #FFFFFF; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 5px; width: 100%; display: block;">Approve PAN</button>`;
        }
        actionsHtml += `<button class="btn-checkout" onclick="downloadUserData('${u.email.replace(/'/g, "\\'")}')" style="padding: 4px 8px; font-size: 0.68rem; margin-top: 0; background: linear-gradient(135deg, #D97706 0%, #B45309 100%); color: #FFFFFF; border: none; border-radius: 4px; cursor: pointer; width: 100%; display: block;">📥 Report PDF</button>`;

        return `
        <tr>
            <td>
                <strong style="color:var(--color-primary);">${u.name}</strong><br>
                <span style="font-size:0.8rem;color:var(--color-silver-dark);">${u.email}</span><br>
                <span style="font-size:0.75rem;font-weight:700;color:#B45309;">Ref Code: ${u.referral_code}</span>
            </td>
            <td style="font-weight: 700; color: var(--color-accent-pink);">
                ${u.balance.toFixed(4)} g
            </td>
            <td>
                Referred: <strong>${u.friends_referred}</strong><br>
                Earned: <strong style="color:#10B981;">₹${u.total_earned.toFixed(2)}</strong>
            </td>
            <td>${aadharHtml}</td>
            <td>${panHtml}</td>
            <td style="text-align: center; vertical-align: middle;">
                <div style="display:flex; flex-direction:column; gap:4px; max-width: 120px; margin: 0 auto;">
                    ${actionsHtml}
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

function filterAdminUsers() {
    const query = document.getElementById("admin-users-search").value.toLowerCase().trim();
    const tbody = document.getElementById("admin-users-tbody");
    if (!tbody || !STATE.adminUsers) return;
    
    const filtered = STATE.adminUsers.filter(u => 
        u.email.toLowerCase().includes(query) || 
        u.name.toLowerCase().includes(query)
    );
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px;">No matching users found</td></tr>';
        return;
    }
    
    renderUsersTable(filtered);
}

async function downloadUserData(email) {
    try {
        // Fetch raw user record
        const { data: userDataRow } = await supaClient.from('settings').select('value').eq('key', 'user_' + email).single();
        let userProfile = null;
        if (userDataRow && userDataRow.value) {
            userProfile = JSON.parse(userDataRow.value);
            if (userProfile.password) userProfile.password = "********";
        }
        
        if (!userProfile) {
            userProfile = { email: email, name: "N/A", message: "No profile settings row found" };
        }
        
        // Filter all orders placed by this user
        const userOrders = STATE.orders.filter(o => {
            const custStr = typeof o.customer === 'string' ? o.customer : JSON.stringify(o.customer || {});
            return custStr.toLowerCase().includes(email.toLowerCase());
        });

        // Initialize jsPDF
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        // Creative Black & White Header Style
        // Top solid black accent stripe (3mm height)
        doc.setFillColor(0, 0, 0);
        doc.rect(0, 0, 210, 4, 'F');

        // Brand Typography
        doc.setTextColor(0, 0, 0);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(24);
        doc.text("UVIRA JEWELS", 15, 20);
        
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        doc.text("CUSTOMER DIGISILVER & REWARDS LEDGER", 15, 27);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 15, 32);

        // Divider Line
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.8);
        doc.line(15, 36, 195, 36);

        // User Overview Section Title
        doc.setTextColor(0, 0, 0);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.text("Customer Profile Summary", 15, 48);
        
        doc.setLineWidth(0.2);
        doc.setDrawColor(180, 180, 180);
        doc.line(15, 51, 195, 51);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(50, 50, 50);

        let y = 58;
        const addRow = (label, val) => {
            doc.setFont("helvetica", "bold");
            doc.setTextColor(0, 0, 0);
            doc.text(label, 15, y);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(80, 80, 80);
            doc.text(String(val), 85, y);
            y += 7;
        };

        addRow("Customer Name:", userProfile.name || "N/A");
        addRow("Customer Email:", userProfile.email || email);
        addRow("DigiSilver Balance:", `${(parseFloat(userProfile.digi_silver_balance) || 0).toFixed(4)} Grams`);
        addRow("Referral Code:", userProfile.referral_code || "N/A");
        addRow("Referred By:", userProfile.referred_by || "None");
        
        // Aadhar and PAN details
        addRow("Aadhar Number:", userProfile.aadhar ? `XXXX-XXXX-${userProfile.aadhar.slice(-4)}` : "Not Verified");
        if (userProfile.aadhar_front) {
            addRow("Aadhar Front File:", userProfile.aadhar_front);
        }
        if (userProfile.aadhar_back) {
            addRow("Aadhar Back File:", userProfile.aadhar_back);
        }
        addRow("PAN Number:", userProfile.pan || "Not Verified");

        // Rewards section
        y += 3;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.setTextColor(0, 0, 0);
        doc.text("Rewards & Commission Activity", 15, y);
        y += 3;
        doc.setLineWidth(0.2);
        doc.line(15, y, 195, y);
        y += 7;

        const commissions = Array.isArray(userProfile.referral_commissions) ? userProfile.referral_commissions : [];
        const totalEarned = commissions.reduce((sum, c) => sum + (parseFloat(c.commission_amount) || 0), 0);
        const friendsReferred = STATE.adminUsers ? STATE.adminUsers.filter(x => x.referred_by === userProfile.referral_code).length : 0;

        addRow("Total Referred Friends:", friendsReferred);
        addRow("Total Earned Commissions:", `INR ${totalEarned.toFixed(2)}`);

        if (commissions.length > 0) {
            y += 5;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.setTextColor(0, 0, 0);
            doc.text("Referral Transactions Log", 15, y);
            y += 4;

            // Draw table header block in black
            doc.setFillColor(0, 0, 0);
            doc.rect(15, y, 180, 6, 'F');
            
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(8);
            doc.setFont("helvetica", "bold");
            doc.text("Date", 17, y + 4.5);
            doc.text("Order ID", 47, y + 4.5);
            doc.text("Buyer", 82, y + 4.5);
            doc.text("Commission", 142, y + 4.5);
            doc.text("Status", 172, y + 4.5);
            y += 10;

            doc.setFont("helvetica", "normal");
            doc.setTextColor(80, 80, 80);
            commissions.forEach(c => {
                if (y > 275) {
                    doc.addPage();
                    doc.setFillColor(0, 0, 0);
                    doc.rect(0, 0, 210, 4, 'F');
                    y = 20;
                }
                const dateStr = c.order_date ? new Date(c.order_date).toLocaleDateString() : "N/A";
                doc.text(dateStr, 17, y);
                doc.text(String(c.order_id), 47, y);
                doc.text(String(c.buyer_name || "N/A"), 82, y);
                doc.text(`INR ${(parseFloat(c.commission_amount) || 0).toFixed(2)}`, 142, y);
                doc.text(c.is_redeemed ? "Redeemed" : "Matured", 172, y);
                y += 6;
            });
        }

        // Orders section
        if (userOrders.length > 0) {
            y += 8;
            if (y > 250) {
                doc.addPage();
                doc.setFillColor(0, 0, 0);
                doc.rect(0, 0, 210, 4, 'F');
                y = 20;
            }
            doc.setFont("helvetica", "bold");
            doc.setFontSize(13);
            doc.setTextColor(0, 0, 0);
            doc.text("Recent Store Orders", 15, y);
            y += 3;
            doc.setLineWidth(0.2);
            doc.line(15, y, 195, y);
            y += 6;

            // Draw table header block in black
            doc.setFillColor(0, 0, 0);
            doc.rect(15, y, 180, 6, 'F');

            doc.setTextColor(255, 255, 255);
            doc.setFontSize(8);
            doc.setFont("helvetica", "bold");
            doc.text("Date", 17, y + 4.5);
            doc.text("Order ID", 47, y + 4.5);
            doc.text("Items Detail", 82, y + 4.5);
            doc.text("Total Paid", 172, y + 4.5);
            y += 10;

            doc.setFont("helvetica", "normal");
            doc.setTextColor(80, 80, 80);
            userOrders.forEach(o => {
                if (y > 275) {
                    doc.addPage();
                    doc.setFillColor(0, 0, 0);
                    doc.rect(0, 0, 210, 4, 'F');
                    y = 20;
                }
                const itemsArr = Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? JSON.parse(o.items || "[]") : []);
                const itemsDesc = itemsArr.map(item => `${item.title} (x${item.qty})`).join(', ');

                doc.text(String(o.date), 17, y);
                doc.text(String(o.id), 47, y);
                
                let desc = itemsDesc;
                if (desc.length > 45) desc = desc.slice(0, 42) + "...";
                doc.text(desc, 82, y);
                
                doc.text(`INR ${(parseFloat(o.total) || 0).toLocaleString("en-IN")}`, 172, y);
                y += 6;
            });
        }

        // Footer note
        if (y > 280) {
            doc.addPage();
            doc.setFillColor(0, 0, 0);
            doc.rect(0, 0, 210, 4, 'F');
            y = 20;
        }
        y += 8;
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text("This is an official audited statement. Generated automatically by UVIRA JEWELS.", 15, y);

        // Save PDF
        const filename = `User_Report_${email.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
        doc.save(filename);

    } catch (e) {
        console.error("Error exporting user data:", e);
        alert("Failed to export user data: " + e.message);
    }
}

function loadAdminCoupons() {
    const tbody = document.getElementById("admin-coupons-tbody");
    if (!tbody) return;
    
    supaClient.from('coupons').select('*').then(({ data, error }) => {
        if (error || !data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">No coupons found</td></tr>';
            return;
        }
        
        tbody.innerHTML = data.map(c => `
            <tr>
                <td style="font-weight: 700; color: var(--color-primary);">${c.code}</td>
                <td><span class="admin-badge ${c.type === 'percentage' ? 'status-pending' : 'status-completed'}">${c.type}</span></td>
                <td>${c.type === 'percentage' ? c.value + '%' : '₹' + c.value}</td>
                <td>${c.single_use ? 'Yes' : 'No'}</td>
                <td><span class="admin-badge ${c.is_used ? 'status-failed' : 'status-completed'}">${c.is_used ? 'Used' : 'Available'}</span></td>
                <td>${c.owner_email || 'Admin/Public'}</td>
            </tr>
        `).join('');
    });
}

function renderAdminDashboard() {
    const totalSalesNode = document.getElementById("admin-stat-sales");
    const totalOrdersNode = document.getElementById("admin-stat-orders");
    const catalogCountNode = document.getElementById("admin-stat-catalog");
    
    const totalSales = STATE.orders
        .filter(o => o.status === "delivered" || o.status === "processing" || o.status === "dispatched")
        .reduce((sum, o) => sum + o.total, 0);
        
    if (totalSalesNode) totalSalesNode.textContent = `₹${totalSales.toLocaleString("en-IN")}`;
    if (totalOrdersNode) totalOrdersNode.textContent = STATE.orders.length;
    if (catalogCountNode) catalogCountNode.textContent = STATE.products.length;
}

// Admin Rate tab loading
function renderAdminRates() {
    const inpSterling = document.getElementById("admin-rate-sterling");
    const inpFine = document.getElementById("admin-rate-fine");
    const inpGold = document.getElementById("admin-rate-gold");
    
    if (inpSterling) inpSterling.value = STATE.rates.sterling.toFixed(2);
    if (inpFine) inpFine.value = STATE.rates.fine.toFixed(2);
    if (inpGold) inpGold.value = (STATE.rates.gold || 7500.00).toFixed(2);
}

async function updateAdminRates() {
    const sterlingVal = parseFloat(document.getElementById("admin-rate-sterling").value);
    const fineVal = parseFloat(document.getElementById("admin-rate-fine").value);
    const goldVal = parseFloat(document.getElementById("admin-rate-gold").value);
    
    if (isNaN(sterlingVal) || isNaN(fineVal) || isNaN(goldVal)) {
        alert("Please enter valid decimal numbers for rates.");
        return;
    }
    
    STATE.rates.sterling = sterlingVal;
    STATE.rates.fine = fineVal;
    STATE.rates.gold = goldVal;
    STATE.rates.trend = "up";
    
    renderRatesTicker();
    recalculateAllProductPrices();
    
    // Rerender active views to show recalculated prices instantly
    if (STATE.currentView === "home") renderHomeProducts();
    if (STATE.currentView === "shop") renderShopCatalog();
    if (STATE.selectedProduct) {
        viewProductDetail(STATE.selectedProduct.id);
    }
    
    try {
        const { error } = await supaClient.from('rates').upsert([{
            id: 1,
            sterling: sterlingVal,
            fine: fineVal,
            gold: goldVal,
            trend: 'up',
            updated_at: new Date().toISOString()
        }]);
        if (error) throw error;
        alert("Live Metal Rates updated on scrolling ticker and saved to Supabase successfully!");
    } catch (err) {
        console.error("Supabase rates update error:", err);
        alert("Rates updated locally, but failed to save to Supabase: " + err.message);
    }
}

// Admin Orders list render
function renderAdminOrders() {
    const ordersTbody = document.getElementById("admin-orders-tbody");
    if (!ordersTbody) return;
    
    if (STATE.orders.length === 0) {
        ordersTbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">No Customer Orders Placed Yet.</td></tr>`;
        return;
    }
    
    ordersTbody.innerHTML = STATE.orders.map(o => {
        const safeItems = Array.isArray(o.items) ? o.items : [];
        const itemTitles = safeItems.map(item => `${item.title} (x${item.qty})`).join(", ");
        const itemsListHtml = safeItems.map(item => `
            <div style="font-size:0.8rem; margin-bottom:2px; display:flex; justify-content:space-between; gap:12px;">
                <span>• ${item.title} <span style="color:var(--color-silver-dark); font-weight:600;">x${item.qty}</span></span>
                <span style="font-weight:600;">₹${(item.price * item.qty).toLocaleString("en-IN")}</span>
            </div>
        `).join("");
        
        let ssBtnHtml = "";
        if (o.payment_screenshot) {
            ssBtnHtml = `
                <div style="margin-top: 8px;">
                    <button onclick="viewPaymentScreenshot('${o.id}')" style="background-color: #3B82F6; color: #FFFFFF; border: none; padding: 4px 8px; border-radius: 4px; font-size: 0.72rem; cursor: pointer; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                        👁️ View Payment SS
                    </button>
                </div>
            `;
        }
        
        let approveBtnHtml = "";
        if (o.status === "awaiting_approval") {
            approveBtnHtml = `
                <div style="margin-top: 6px;">
                    <button onclick="approveOrderPayment('${o.id}')" style="background-color: #10B981; color: #FFFFFF; border: none; padding: 6px 10px; border-radius: 4px; font-size: 0.72rem; cursor: pointer; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 2px 4px rgba(16,185,129,0.2);">
                        ✓ Approve Payment
                    </button>
                </div>
            `;
        }
        
        return `
            <tr>
                <td style="font-weight:700; vertical-align: top;">${o.id}</td>
                <td style="vertical-align: top;">${o.date}</td>
                <td style="vertical-align: top;">
                    <div style="font-weight:600;">${o.customer && o.customer.name ? o.customer.name : o.customer}</div>
                    <div style="font-size:0.75rem;color:var(--color-silver-dark);">${o.phone}</div>
                    <div style="font-size:0.75rem;color:var(--color-silver-dark);margin-top:4px; max-width:250px; white-space:pre-wrap; line-height:1.4;">📍 <strong>Address:</strong> ${o.address}</div>
                    <div style="font-size:0.7rem;font-weight:700;color:var(--color-accent-pink);margin-top:6px; text-transform:uppercase;">💳 ${o.paymentMethod || o.payment_method || "COD"}</div>
                    ${ssBtnHtml}
                </td>
                <td style="vertical-align: top; max-width:320px;">
                    <div style="display:flex; flex-direction:column;">
                        ${itemsListHtml}
                    </div>
                </td>
                <td style="vertical-align: top;">
                    <div style="font-weight:700; font-size: 0.95rem; color: var(--color-primary);">₹${(o.total || 0).toLocaleString("en-IN")}</div>
                    <div style="font-size:0.72rem;color:var(--color-silver-dark);margin-top:4px; line-height: 1.4;">
                        Subtotal: ₹${(o.subtotal || 0).toLocaleString("en-IN")}<br>
                        Discount: -₹${(o.discount || 0).toLocaleString("en-IN")}
                    </div>
                </td>
                <td style="vertical-align: top;">
                    <select class="admin-status-badge status-${o.status}" onchange="changeOrderStatus('${o.id}', this.value)" style="border:none;outline:none;cursor:pointer; font-weight:600;">
                        <option value="awaiting_approval" ${o.status === "awaiting_approval" ? "selected" : ""}>Awaiting Approval</option>
                        <option value="placed" ${o.status === "placed" ? "selected" : ""}>Placed</option>
                        <option value="processing" ${o.status === "processing" ? "selected" : ""}>Processing</option>
                        <option value="dispatched" ${o.status === "dispatched" ? "selected" : ""}>Dispatched</option>
                        <option value="delivered" ${o.status === "delivered" ? "selected" : ""}>Delivered</option>
                    </select>
                    ${approveBtnHtml}
                </td>
                <td style="vertical-align: top; text-align: center;">
                    <button class="btn-checkout" onclick="downloadOrderInvoicePdf('${o.id}')" style="padding: 6px 12px; font-size: 0.72rem; margin-top: 0; background: linear-gradient(135deg, #1A365D 0%, #2A4365 100%); color: #FFFFFF; border: none; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 6px;">
                        📄 PDF Copy
                    </button>
                    <button onclick="deleteInvalidOrder('${o.id}')" style="padding: 6px 12px; font-size: 0.72rem; background: #fee2e2; color: #ef4444; border: none; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; box-shadow: 0 2px 4px rgba(239,68,68,0.1);">
                        🗑️ Delete
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

function approveOrderPayment(orderId) {
    if (confirm("Are you sure you want to approve the payment for this order? This will transition the status to Placed (Confirmed).")) {
        const order = STATE.orders.find(o => o.id === orderId);
        if (order) {
            order.status = "placed";
            renderAdminOrders();
            supaClient.from('orders').update({ status: "placed" }).eq('id', orderId)
                .then(async () => {
                    alert("Order approved successfully!");
                    
                    // Credit Digi Silver balance
                    await creditDigiSilverForOrder(order);
                    
                    // Credit referral commission
                    await creditReferralCommissionForOrder(order);
                    
                    // Sync lookup portal if open
                    const trackInp = document.getElementById("track-order-id-input");
                    if (trackInp && trackInp.value.trim().toUpperCase() === orderId.toUpperCase()) {
                        lookupOrderStatus();
                    }
                })
                .catch(e => console.error("Error approving order in DB:", e));
        }
    }
}

async function deleteInvalidOrder(orderId) {
    if (confirm("Are you sure you want to permanently delete this order? This action cannot be undone.")) {
        // Update UI immediately
        STATE.orders = STATE.orders.filter(o => o.id !== orderId);
        renderAdminOrders();
        
        try {
            const { error } = await supaClient.from('orders').delete().eq('id', orderId);
            if (error) throw error;
        } catch (e) {
            console.error("Error deleting order:", e);
            alert("Failed to delete order from database: " + e.message);
        }
    }
}

function viewPaymentScreenshot(orderId) {
    const order = STATE.orders.find(o => o.id === orderId);
    if (!order || !order.payment_screenshot) {
        alert("No payment screenshot available for this order.");
        return;
    }
    
    let ssOverlay = document.getElementById("admin-ss-view-overlay");
    let ssModal = document.getElementById("admin-ss-view-modal");
    if (!ssOverlay) {
        ssOverlay = document.createElement("div");
        ssOverlay.id = "admin-ss-view-overlay";
        ssOverlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:9999; display:flex; align-items:center; justify-content:center; cursor:pointer;";
        ssOverlay.onclick = () => {
            ssOverlay.style.display = "none";
        };
        
        ssModal = document.createElement("div");
        ssModal.id = "admin-ss-view-modal";
        ssModal.style.cssText = "background:#FFFFFF; padding:20px; border-radius:12px; max-width:90%; max-height:90vh; overflow-y:auto; cursor:default; position:relative; box-shadow: 0 10px 25px rgba(0,0,0,0.5); display:flex; flex-direction:column; align-items:center;";
        ssModal.onclick = (e) => e.stopPropagation();
        
        const closeBtn = document.createElement("button");
        closeBtn.innerHTML = "✕";
        closeBtn.style.cssText = "position:absolute; top:10px; right:15px; background:none; border:none; font-size:1.5rem; font-weight:bold; cursor:pointer; color:#333;";
        closeBtn.onclick = () => {
            ssOverlay.style.display = "none";
        };
        
        const img = document.createElement("img");
        img.id = "admin-ss-view-img";
        img.style.cssText = "width:100%; height:auto; max-height:80vh; object-fit:contain; border-radius:6px; margin-top:20px;";
        
        ssModal.appendChild(closeBtn);
        ssModal.appendChild(img);
        ssOverlay.appendChild(ssModal);
        document.body.appendChild(ssOverlay);
    }
    
    document.getElementById("admin-ss-view-img").src = order.payment_screenshot;
    ssOverlay.style.display = "flex";
}

function changeOrderStatus(orderId, newStatus) {
    const order = STATE.orders.find(o => o.id === orderId);
    if (order) {
        const oldStatus = order.status;
        order.status = newStatus;
        
        renderAdminOrders();
        supaClient.from('orders').update({ status: newStatus }).eq('id', orderId).then().catch(e => console.error(e));
        
        // Credit Digi Silver when order moves to placed or delivered (if not already credited)
        const creditStatuses = ["placed", "delivered"];
        const nonCreditStatuses = ["awaiting_approval", "processing"];
        if (creditStatuses.includes(newStatus) && (nonCreditStatuses.includes(oldStatus) || !oldStatus)) {
            creditDigiSilverForOrder(order);
            creditReferralCommissionForOrder(order);
        }
        
        // If lookup order status currently renders this, sync details
        const trackInp = document.getElementById("track-order-id-input");
        if (trackInp && trackInp.value.trim().toUpperCase() === orderId.toUpperCase()) {
            lookupOrderStatus();
        }
    }
}

async function creditDigiSilverForOrder(order) {
    let digiGrams = 0;
    const itemsArr = typeof order.items === 'string' ? safeJSONParse(order.items, []) : (order.items || []);
    itemsArr.forEach(item => {
        const isDigi = item.isDigiSilver || (item.title && item.title.toLowerCase().includes('digi silver'));
        if (isDigi && item.grams) digiGrams += parseFloat(item.grams);
    });
    
    if (digiGrams <= 0) return;
    
    const cust = typeof order.customer === 'string' ? safeJSONParse(order.customer, {}) : (order.customer || {});
    if (!cust.email) return;
    
    // Prevent double crediting
    if (cust.digi_credited) {
        console.log(`Order ${order.id} Digi Silver already credited.`);
        return;
    }
    
    try {
        // Mark as credited first in the order object customer field
        cust.digi_credited = true;
        
        // Sync local object customer representation
        order.customer = cust;
        
        // Update the order in Supabase
        await supaClient.from('orders').update({ customer: JSON.stringify(cust) }).eq('id', order.id);
        
        const { data: userData } = await supaClient.from('settings').select('value').eq('key', 'user_' + cust.email).single();
        if (userData && userData.value) {
            const uRec = JSON.parse(userData.value);
            if (!cust.token || uRec.token === cust.token) {
                uRec.digi_silver_balance = (uRec.digi_silver_balance || 0) + digiGrams;
                await supaClient.from('settings').update({ value: JSON.stringify(uRec) }).eq('key', 'user_' + cust.email);
                console.log(`Credited ${digiGrams}g Digi Silver to ${cust.email}`);
                
                // Also update local STATE if this is the current user
                if (STATE.user && STATE.user.email === cust.email) {
                    STATE.profile.digi_silver_balance = uRec.digi_silver_balance;
                    STATE.user.digi_silver_balance = uRec.digi_silver_balance;
                    updateProfileUI();
                }
            }
        }
    } catch(e) {
        console.error("Error crediting Digi Silver balance:", e);
    }
}


async function creditReferralCommissionForOrder(order) {
    try {
        const cust = typeof order.customer === 'string' ? safeJSONParse(order.customer, {}) : (order.customer || {});
        if (!cust.email) return;
        if (cust.referral_credited) return;
        
        const { data: userData } = await supaClient.from('settings').select('value').eq('key', 'user_' + cust.email).single();
        if (!userData || !userData.value) return;
        const buyerRec = JSON.parse(userData.value);
        const referrerCode = buyerRec.referred_by;
        if (!referrerCode) return;
        
        const { data: allSettings } = await supaClient.from('settings').select('*').like('key', 'user_%');
        const users = allSettings ? allSettings.filter(s => s.key.startsWith('user_')).map(s => {
            try { return JSON.parse(s.value); } catch(e) { return null; }
        }).filter(Boolean) : [];
        
        const referrer = users.find(u => u.referral_code === referrerCode);
        if (!referrer) return;
        
        const itemsArr = typeof order.items === 'string' ? safeJSONParse(order.items, []) : (order.items || []);
        const discount = parseFloat(order.discount) || 0;
        const orderSubtotal = itemsArr.reduce((sum, it) => sum + (parseFloat(it.price) * (it.qty || 1)), 0);
        const discountProportion = orderSubtotal > 0 ? (discount / orderSubtotal) : 0;
        
        let totalCommission = 0;
        let silverBase = 0;
        let goldBase = 0;
        
        itemsArr.forEach(item => {
            const isDigi = item.isDigiSilver || (item.title && item.title.toLowerCase().includes('digi silver'));
            const qty = item.qty || 1;
            const price = parseFloat(item.price);
            
            if (isDigi) {
                const itemTaxableAmount = price * qty;
                const itemCommission = itemTaxableAmount * 0.05;
                totalCommission += itemCommission;
                silverBase += itemTaxableAmount;
            } else {
                const itemSubtotal = price * qty;
                const itemDiscountedSubtotal = itemSubtotal * (1 - discountProportion);
                const itemTaxableAmount = itemDiscountedSubtotal * 100 / 103;
                
                const titleLower = (item.title || "").toLowerCase();
                const isGold = titleLower.includes('gold') || (titleLower.includes('ganesha') && !titleLower.includes('silver'));
                if (isGold) {
                    const itemCommission = itemTaxableAmount * 0.01;
                    totalCommission += itemCommission;
                    goldBase += itemTaxableAmount;
                } else {
                    const itemCommission = itemTaxableAmount * 0.05;
                    totalCommission += itemCommission;
                    silverBase += itemTaxableAmount;
                }
            }
        });
        
        if (totalCommission <= 0) return;
        
        if (!referrer.referral_commissions) referrer.referral_commissions = [];
        if (referrer.referral_commissions.some(c => c.order_id === order.id)) return;
        
        referrer.referral_commissions.push({
            order_id: order.id,
            buyer_email: cust.email,
            buyer_name: buyerRec.name || cust.email.split('@')[0],
            order_date: new Date().toISOString(),
            commission_amount: parseFloat(totalCommission.toFixed(2)),
            silver_taxable_base: parseFloat(silverBase.toFixed(2)),
            gold_taxable_base: parseFloat(goldBase.toFixed(2)),
            is_redeemed: false
        });
        
        await supaClient.from('settings').update({ value: JSON.stringify(referrer) }).eq('key', 'user_' + referrer.email);
        
        cust.referral_credited = true;
        order.customer = cust;
        await supaClient.from('orders').update({ customer: JSON.stringify(cust) }).eq('id', order.id);
        
        console.log(`Credited referral commission of ₹${totalCommission.toFixed(2)} to ${referrer.email} for order ${order.id}`);
        
        if (STATE.user && STATE.user.email === referrer.email) {
            STATE.user = referrer;
            updateProfileUI();
        }
    } catch (e) {
        console.error("Error processing referral commission:", e);
    }
}

// Add Custom Coupon Tool inside Admin
function createAdminCoupon() {
    const codeInp = document.getElementById("admin-coupon-code");
    const valInp = document.getElementById("admin-coupon-value");
    const typeSel = document.getElementById("admin-coupon-type");
    const singleUseCb = document.getElementById("admin-coupon-single-use");
    
    if (!codeInp || !valInp || !typeSel) return;
    
    const code = codeInp.value.trim().toUpperCase();
    const type = typeSel.value;
    const value = parseFloat(valInp.value);
    const singleUse = singleUseCb ? singleUseCb.checked : false;
    
    if (!code || isNaN(value) || value <= 0) {
        alert("Please enter a valid coupon code and value.");
        return;
    }
    
    if (type === "percentage" && (value <= 0 || value > 100)) {
        alert("Please enter a percentage value between 1 and 100.");
        return;
    }
    
    // Cache locally
    STATE.coupons[code] = {
        code: code,
        type: type,
        value: value,
        is_used: false,
        single_use: singleUse
    };
    
    supaClient.from('coupons').insert([{ 
        code: code, 
        discount: type === 'percentage' ? value : 0, // legacy compatibility
        type: type,
        value: value,
        is_used: false,
        single_use: singleUse
    }]).then(() => {
        const typeStr = type === 'free_silver' ? `${value}g Free Silver` : `${value}% OFF`;
        const limitStr = singleUse ? ' (Single Use)' : '';
        alert(`Success! Created Coupon Code: ${code} (${typeStr})${limitStr}. Ready for Cart use.`);
    }).catch(err => {
        console.error(err);
        alert("Error creating coupon code. It might already exist.");
    });
    
    codeInp.value = "";
    valInp.value = "";
    if (singleUseCb) {
        singleUseCb.checked = (type === 'free_silver');
    }
}

function adjustCouponPlaceholder(selectEl) {
    const valueLabel = document.getElementById("admin-coupon-value-label");
    const valueInp = document.getElementById("admin-coupon-value");
    const singleUseCb = document.getElementById("admin-coupon-single-use");
    if (!valueLabel || !valueInp) return;
    
    if (selectEl.value === "free_silver") {
        valueLabel.textContent = "Free Silver Weight (Grams)";
        valueInp.placeholder = "e.g. 5.5";
        valueInp.removeAttribute("max");
        valueInp.removeAttribute("min");
        if (singleUseCb) singleUseCb.checked = true;
    } else {
        valueLabel.textContent = "Discount Value Percentage (1-100%)";
        valueInp.placeholder = "e.g. 20";
        valueInp.min = 1;
        valueInp.max = 100;
        if (singleUseCb) singleUseCb.checked = false;
    }
}

// Admin Catalog items list render
function renderAdminInventoryList() {
    const inventoryTbody = document.getElementById("admin-inventory-tbody");
    if (!inventoryTbody) return;
    
    const filterSelect = document.getElementById("admin-inventory-filter-category");
    const selectedCategory = filterSelect ? filterSelect.value : "all";
    
    const filtered = STATE.products.filter(p => {
        if (selectedCategory !== "all" && p.category !== selectedCategory) return false;
        return true;
    });
    
    inventoryTbody.innerHTML = filtered.map(p => `
        <tr>
            <td><img src="${p.image}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;" alt=""></td>
            <td style="font-weight:600;">${p.title}</td>
            <td style="text-transform:uppercase;font-size:0.75rem;">${formatCategoryName(p.category)}</td>
            <td>₹${p.price.toLocaleString("en-IN")}</td>
            <td>
                <span class="admin-status-badge" style="background-color:${p.inStock ? '#D1FAE5;color:#047857;' : '#FEE2E2;color:#991B1B;'}">
                    ${p.inStock ? `IN STOCK (${(p.specs && p.specs.stock_qty !== undefined) ? p.specs.stock_qty : 10} pcs)` : 'OUT OF STOCK'}
                </span>
            </td>
            <td>
                <button onclick="editProduct('${p.id}')" style="color:var(--color-accent-pink);font-size:0.78rem;font-weight:600;margin-right:12px;">Edit</button>
                <button onclick="deleteProduct('${p.id}')" style="color:#EF4444;font-size:0.78rem;font-weight:600;">Delete</button>
            </td>
        </tr>
    `).join("");
}

function handleStockStatusChange() {
    const stockStatus = document.getElementById("new-prod-stock").value;
    const qtyInput = document.getElementById("new-prod-qty");
    if (qtyInput) {
        if (stockStatus === "false") {
            qtyInput.value = "0";
        } else if (stockStatus === "true" && (parseInt(qtyInput.value) || 0) <= 0) {
            qtyInput.value = "10";
        }
    }
}

function handleStockQtyChange() {
    const qtyInput = document.getElementById("new-prod-qty");
    const stockSelect = document.getElementById("new-prod-stock");
    if (qtyInput && stockSelect) {
        const val = parseInt(qtyInput.value) || 0;
        if (val <= 0) {
            stockSelect.value = "false";
        } else {
            stockSelect.value = "true";
        }
    }
}

async function addNewProduct() {
    const btn = document.querySelector('button[onclick="addNewProduct()"]');
    if (btn) btn.innerHTML = "Uploading & Saving...";
    if (btn) btn.disabled = true;

    const title = document.getElementById("new-prod-title").value.trim();
    const category = document.getElementById("new-prod-cat").value;
    const gender = document.getElementById("new-prod-gender") ? document.getElementById("new-prod-gender").value : "both";
    const basePrice = parseFloat(document.getElementById("new-prod-price").value);
    const isManual = document.getElementById("new-prod-disable-autorate").checked;
    const gstVal = parseFloat(document.getElementById("new-prod-calc-gst").value) || 3;
    
    let price = basePrice;
    let manualBasePrice = undefined;
    if (isManual) {
        manualBasePrice = Math.round(basePrice * 100 / (100 + gstVal));
        price = basePrice;
    }
    const origPrice = parseFloat(document.getElementById("new-prod-orig").value) || price * 2;
    let image = "https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=600&q=80"; // default
    
    const plating = document.getElementById("new-prod-finish").value;
    const desc = document.getElementById("new-prod-desc").value.trim() || "Genuine 925 sterling silver exquisite ornament piece.";
    const weight = document.getElementById("new-prod-weight").value.trim() || "2.5 grams";
    const width = document.getElementById("new-prod-width").value.trim() || "N/A";
    const stockQty = parseInt(document.getElementById("new-prod-qty").value) || 0;
    const inStock = stockQty > 0 && document.getElementById("new-prod-stock").value === "true";
    
    if (!title || isNaN(basePrice) || basePrice <= 0) {
        alert("Please enter a valid Product Title and Base Price.");
        if (btn) btn.innerHTML = "Add Item to Catalog";
        if (btn) btn.disabled = false;
        return;
    }
    
    // Process Supabase Storage Upload
    const fileInput = document.getElementById("new-prod-img-file");
    if (fileInput && fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.floor(Math.random() * 1000)}.${fileExt}`;
        
        const { data: uploadData, error: uploadError } = await supaClient.storage
            .from('product-images')
            .upload(fileName, file, { contentType: file.type });
            
        if (uploadError) {
            console.error("Storage upload error", uploadError);
            alert("Failed to upload image. Using default.");
        } else if (uploadData) {
            const { data: publicUrlData } = supaClient.storage.from('product-images').getPublicUrl(fileName);
            image = publicUrlData.publicUrl;
        }
    } else {
        // Fallback to base64 if someone manually pasted an image (not recommended anymore but keeping it so it doesn't break)
        const base64 = document.getElementById("new-prod-img-base64").value;
        if (base64) image = base64;
    }
    
    const newId = `prod-${STATE.products.length + 1}-${Date.now().toString().slice(-4)}`;
    
    const product = {
        id: newId,
        title: title,
        category: category,
        gender: gender,
        price: price,
        originalPrice: origPrice,
        rating: 4.8,
        reviewsCount: 1,
        plating: plating,
        inStock: inStock,
        image: image,
        description: desc,
        specs: {
            metal: document.getElementById("new-prod-market-base").value === "gold" ? "24K Gold" : (document.getElementById("new-prod-market-base").value === "fine" ? "625 Silver" : "925 Sterling Silver"),
            weight: weight,
            width: width,
            authenticity: document.getElementById("new-prod-market-base").value === "gold" ? "NABL Lab-Certified Gold Assay Card Included" : (document.getElementById("new-prod-market-base").value === "fine" ? "NABL Lab-Tested Certificate Included" : "92.5 Hallmark Certificate Included"),
            calc_weight: parseFloat(document.getElementById("new-prod-calc-weight").value),
            calc_making: parseFloat(document.getElementById("new-prod-calc-making").value) || 0,
            calc_making_type: document.getElementById("new-prod-calc-making-type").value,
            calc_gst: gstVal,
            market_base: document.getElementById("new-prod-market-base").value,
            disable_auto_rate: isManual,
            manual_base_price: manualBasePrice,
            stock_qty: stockQty,
            available_sizes: document.getElementById("new-prod-available-sizes") ? document.getElementById("new-prod-available-sizes").value.trim() : "",
            gender: gender
        }
    };
    
    STATE.products.push(product);
    
    const dbProduct = {
        id: product.id,
        title: product.title,
        category: product.category,
        price: product.price,
        original_price: product.originalPrice,
        rating: product.rating,
        reviews_count: product.reviewsCount,
        plating: product.plating,
        in_stock: product.inStock,
        image: product.image,
        description: product.description,
        specs: product.specs
    };
    await supaClient.from('products').insert([dbProduct]).then().catch(e => console.error(e));
    
    if (btn) btn.innerHTML = "Add Item to Catalog";
    if (btn) btn.disabled = false;
    
    // Clear forms
    document.getElementById("new-prod-title").value = "";
    document.getElementById("new-prod-price").value = "";
    document.getElementById("new-prod-orig").value = "";
    document.getElementById("new-prod-img-file").value = "";
    document.getElementById("new-prod-img-base64").value = "";
    document.getElementById("new-prod-finish").value = "silver";
    document.getElementById("new-prod-stock").value = "true";
    document.getElementById("new-prod-qty").value = "10";
    const previewWrap = document.getElementById("new-prod-img-preview-wrap");
    if (previewWrap) previewWrap.style.display = "none";
    const previewImg = document.getElementById("new-prod-img-preview");
    if (previewImg) previewImg.src = "";
    
    document.getElementById("new-prod-weight").value = "";
    document.getElementById("new-prod-width").value = "";
    document.getElementById("new-prod-desc").value = "";
    
    // Clear calculation helper inputs
    const calcWeight = document.getElementById("new-prod-calc-weight");
    const calcMaking = document.getElementById("new-prod-calc-making");
    const calcMakingType = document.getElementById("new-prod-calc-making-type");
    const calcGst = document.getElementById("new-prod-calc-gst");
    const breakdown = document.getElementById("rate-calculation-breakdown");
    
    if (calcWeight) calcWeight.value = "";
    if (calcMaking) calcMaking.value = "";
    if (calcMakingType) calcMakingType.value = "per-gram";
    if (calcGst) calcGst.value = "3";
    if (breakdown) {
        breakdown.innerHTML = "";
        breakdown.style.display = "none";
    }
    const disableCheckbox = document.getElementById("new-prod-disable-autorate");
    if (disableCheckbox) disableCheckbox.checked = false;
    toggleAutoRateFields();
    
    alert(`Success! "${title}" added to the shop catalog.`);
    renderAdminInventoryList();
}

function deleteProduct(prodId) {
    if (confirm("Are you sure you want to delete this product from the inventory catalog?")) {
        const idx = STATE.products.findIndex(p => p.id === prodId);
        if (idx !== -1) {
            STATE.products.splice(idx, 1);
            
            renderAdminInventoryList();
            supaClient.from('products').delete().eq('id', prodId).then().catch(e => console.error(e));
        }
    }
}

async function changeAdminPassword() {
    const currentInp = document.getElementById("admin-current-password");
    const newInp = document.getElementById("admin-new-password");
    if (!currentInp || !newInp) return;
    
    const currentVal = currentInp.value;
    const newVal = newInp.value.trim();
    
    if (!currentVal || !newVal) {
        alert("Please fill in both current and new password fields.");
        return;
    }
    
    const savedPassword = STATE.adminPassword || localStorage.getItem("mrt_admin_password") || "mrt925";
    if (currentVal !== savedPassword) {
        alert("Incorrect current password. Password change denied.");
        return;
    }
    
    if (newVal.length < 4) {
        alert("New password must be at least 4 characters long.");
        return;
    }
    
    try {
        await supaClient.from('settings').upsert({ key: 'admin_password', value: newVal }, { onConflict: 'key' });
        STATE.adminPassword = newVal;
        localStorage.setItem("mrt_admin_password", newVal);
        alert("Admin password updated successfully and saved to Supabase!");
    } catch (err) {
        console.error("Failed to save admin password to Supabase:", err);
        localStorage.setItem("mrt_admin_password", newVal);
        alert("Admin password updated locally, but failed to save to Supabase: " + err.message);
    }
    
    currentInp.value = "";
    newInp.value = "";
}

// --- ADMIN AUTH MODAL ENGINE ---
function openAdminAuthModal() {
    const modal = document.getElementById("admin-auth-modal");
    const overlay = document.getElementById("admin-auth-overlay");
    const input = document.getElementById("admin-auth-input");
    
    if (modal && overlay) {
        modal.style.display = "block";
        overlay.style.display = "block";
        if (input) {
            input.value = "";
            setTimeout(() => input.focus(), 50);
        }
    }
}

function closeAdminAuthModal() {
    const modal = document.getElementById("admin-auth-modal");
    const overlay = document.getElementById("admin-auth-overlay");
    
    if (modal && overlay) {
        modal.style.display = "none";
        overlay.style.display = "none";
    }
}

function submitAdminAuth() {
    const input = document.getElementById("admin-auth-input");
    if (!input) return;
    
    const password = input.value;
    const savedPassword = STATE.adminPassword || localStorage.getItem("mrt_admin_password") || "mrt925";
    
    if (password === savedPassword) {
        sessionStorage.setItem("mrt_admin_authenticated", "true");
        const btn = document.getElementById("admin-toggle");
        if (btn) btn.textContent = "Exit Admin";
        closeAdminAuthModal();
        navigateTo("admin");
    } else {
        alert("Incorrect password. Access denied.");
    }
}

// Global helper: Toggle between E-commerce and Admin dashboard UI
function toggleAdminMode() {
    const btn = document.getElementById("admin-toggle");
    if (STATE.currentView === "admin") {
        sessionStorage.removeItem("mrt_admin_authenticated");
        btn.textContent = "Admin Panel";
        navigateTo("home");
    } else {
        openAdminAuthModal();
    }
}

function initTryOnDragAndDrop() {
    console.log("Virtual Try-On is currently disabled.");
}

// --- BANNER IMAGE MANAGER ---
// Default fallback URLs for each slot
const BANNER_DEFAULTS = {
    hero: 'hero_banner_new.jpg',
    'hero-mobile': 'hero_banner_new.jpg',
    rings: 'ring.jpeg',
    earrings: 'earring.jpeg',
    pendants: 'pendant.jpeg',
    bracelets: 'bracelet.jpeg',
    anklets: 'anklets.jpeg',
    chains: 'chains.jpeg',
    him: 'https://images.unsplash.com/photo-1603561591411-07134e71a2a9?auto=format&fit=crop&w=800&q=80',
    her: 'https://images.unsplash.com/photo-1635767798638-3e25273a8236?auto=format&fit=crop&w=800&q=80',
    'him-mobile': 'https://images.unsplash.com/photo-1603561591411-07134e71a2a9?auto=format&fit=crop&w=400&q=80',
    'her-mobile': 'https://images.unsplash.com/photo-1635767798638-3e25273a8236?auto=format&fit=crop&w=400&q=80',
    gold: 'https://images.unsplash.com/photo-1575377427642-087cf684f29d?auto=format&fit=crop&w=300&q=80',
    kids: 'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?auto=format&fit=crop&w=300&q=80',
    customised: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=300&q=80',
    qr: ''
};

// Upload image to Supabase Storage, save URL in settings table, apply live
async function handleBannerUpload(event, slot) {
    const file = event.target.files[0];
    if (!file) return;

    const toastEl = document.createElement('div');
    toastEl.textContent = `⏳ Uploading ${slot} image...`;
    Object.assign(toastEl.style, {
        position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
        background: '#1a0a2e', color: '#FFD700', padding: '12px 24px',
        borderRadius: '30px', fontWeight: '700', zIndex: '99999', fontSize: '0.9rem',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)'
    });
    document.body.appendChild(toastEl);

    try {
        // Upload to Supabase Storage bucket "banners"
        const fileName = `banner_${slot}_${Date.now()}.${file.name.split('.').pop()}`;
        const { data: uploadData, error: uploadError } = await supaClient.storage
            .from('banners')
            .upload(fileName, file, { upsert: true, contentType: file.type });

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: urlData } = supaClient.storage.from('banners').getPublicUrl(fileName);
        const publicUrl = urlData.publicUrl;

        // Save to settings table
        await supaClient.from('settings').upsert(
            { key: `banner_${slot}`, value: publicUrl },
            { onConflict: 'key' }
        );

        // Apply live immediately
        applyBannerSlot(slot, publicUrl);

        // Update preview in admin panel
        const preview = document.getElementById(`banner-preview-${slot}`);
        if (preview) preview.src = publicUrl;

        toastEl.textContent = `✅ ${slot.charAt(0).toUpperCase() + slot.slice(1)} image updated!`;
        toastEl.style.background = '#065F46';
        toastEl.style.color = '#fff';
    } catch (err) {
        // Fallback: use base64 via FileReader if Supabase storage not available
        const reader = new FileReader();
        reader.onload = async (e) => {
            const dataUrl = e.target.result;
            // Save as base64 in settings table
            await supaClient.from('settings').upsert(
                { key: `banner_${slot}`, value: dataUrl },
                { onConflict: 'key' }
            );
            applyBannerSlot(slot, dataUrl);
            const preview = document.getElementById(`banner-preview-${slot}`);
            if (preview) preview.src = dataUrl;
            toastEl.textContent = `✅ ${slot.charAt(0).toUpperCase() + slot.slice(1)} image updated!`;
            toastEl.style.background = '#065F46';
            toastEl.style.color = '#fff';
        };
        reader.readAsDataURL(file);
    }

    setTimeout(() => toastEl.remove(), 3000);
}

// Reset banner back to default
async function resetBannerImage(slot) {
    const defaultUrl = BANNER_DEFAULTS[slot] || '';
    // Remove from settings table
    await supaClient.from('settings').delete().eq('key', `banner_${slot}`);
    // Apply default
    applyBannerSlot(slot, defaultUrl);
    const preview = document.getElementById(`banner-preview-${slot}`);
    if (preview) preview.src = defaultUrl;
    showToast(`${slot.charAt(0).toUpperCase() + slot.slice(1)} reset to default.`);
}

// Apply a banner URL to the actual live page elements
function applyBannerSlot(slot, url) {
    if (slot === 'hero') {
        const heroBg = document.getElementById('hero-bg-desktop') || document.querySelector('.hero-slide-bg');
        if (heroBg) heroBg.src = url;
        return;
    }
    if (slot === 'hero-mobile') {
        const heroMobileBg = document.getElementById('hero-bg-mobile');
        if (heroMobileBg) heroMobileBg.srcset = url;
        return;
    }
    if (slot === 'him') {
        const himImg = document.getElementById('gender-banner-him-img');
        if (himImg) himImg.src = url;
        return;
    }
    if (slot === 'her') {
        const herImg = document.getElementById('gender-banner-her-img');
        if (herImg) herImg.src = url;
        return;
    }
    if (slot === 'him-mobile') {
        const himMobileImg = document.getElementById('gender-banner-him-mobile-img');
        if (himMobileImg) himMobileImg.srcset = url;
        return;
    }
    if (slot === 'her-mobile') {
        const herMobileImg = document.getElementById('gender-banner-her-mobile-img');
        if (herMobileImg) herMobileImg.srcset = url;
        return;
    }
    if (slot === 'qr') {
        const qrImg = document.getElementById('checkout-upi-qr-img');
        const qrSvg = document.getElementById('checkout-upi-qr-svg');
        if (url && url.trim() !== '') {
            if (qrImg) { qrImg.src = url; qrImg.style.display = 'block'; }
            if (qrSvg) qrSvg.style.display = 'none';
        } else {
            if (qrImg) qrImg.style.display = 'none';
            if (qrSvg) qrSvg.style.display = 'block';
        }
        return;
    }
    // Category circles: find the img inside cat-circle-item for the given category
    const catMap = {
        rings: 'rings', earrings: 'earrings', pendants: 'pendants',
        bracelets: 'bracelets', anklets: 'anklets', chains: 'chains',
        gold: 'gold', kids: 'kids', customised: 'customisation'
    };
    if (catMap[slot]) {
        // Find by onclick attribute containing the category name
        const items = document.querySelectorAll('.cat-circle-item');
        items.forEach(item => {
            const onclick = item.getAttribute('onclick') || '';
            if (onclick.includes(`'${catMap[slot]}'`)) {
                const img = item.querySelector('.cat-circle-img-wrap img');
                if (img) img.src = url;
            }
        });
    }
}

// Load all saved banner images from Supabase on page load
// Load all saved banner images from Supabase on page load
async function applyBannerImages() {
    try {
        const { data, error } = await supaClient
            .from('settings')
            .select('key, value');

        if (error || !data) return;
        data.forEach(row => {
            if (row.key.startsWith('banner_')) {
                const slot = row.key.replace('banner_', '');
                if (row.value) applyBannerSlot(slot, row.value);
                // Also update admin previews if visible
                const preview = document.getElementById(`banner-preview-${slot}`);
                if (preview && row.value) preview.src = row.value;
            }
            
            // Handle UPI ID setting specifically
            if (row.key === 'admin_upi_id') {
                const upiDisplay = document.getElementById('checkout-upi-id-display');
                if (upiDisplay) upiDisplay.textContent = `UPI ID: ${row.value}`;
                const upiInput = document.getElementById('admin-upi-id-input');
                if (upiInput) upiInput.value = row.value;
            }

            // Custom ticker announcement message
            if (row.key === 'ticker_custom_message') {
                STATE.tickerCustomMessage = row.value;
                const tickerInput = document.getElementById('admin-ticker-msg-input');
                if (tickerInput) tickerInput.value = row.value;
            }

            // Admin password setting specifically
            if (row.key === 'admin_password') {
                STATE.adminPassword = row.value;
            }

            // Hero banner title overlay
            if (row.key === 'hero_title') {
                STATE.heroTitle = row.value;
                const titleInput = document.getElementById('admin-hero-title-input');
                if (titleInput) titleInput.value = row.value;
            }

            // Hero banner subtitle overlay
            if (row.key === 'hero_subtitle') {
                STATE.heroSubtitle = row.value;
                const subtitleInput = document.getElementById('admin-hero-subtitle-input');
                if (subtitleInput) subtitleInput.value = row.value;
            }
        });
        
        // Re-render ticker with custom announcement text
        renderRatesTicker();
        // Render hero text overlay
        renderHeroTextOverlay();
    } catch (e) {
        console.warn('Banner/Settings load failed:', e);
    }
}

// Render the hero text overlay on the hero banner
function renderHeroTextOverlay() {
    const overlay = document.getElementById("hero-banner-overlay");
    const titleEl = document.getElementById("hero-overlay-title");
    const subtitleEl = document.getElementById("hero-overlay-subtitle");
    
    if (!overlay) return;
    
    const titleVal = STATE.heroTitle || "";
    const subtitleVal = STATE.heroSubtitle || "";
    
    if (titleVal.trim() === "" && subtitleVal.trim() === "") {
        overlay.style.display = "none";
    } else {
        overlay.style.display = "flex";
        if (titleEl) titleEl.textContent = titleVal;
        if (subtitleEl) subtitleEl.textContent = subtitleVal;
    }
}

// Save the banner and ticker announcement texts to Supabase settings
async function saveBannerTexts() {
    const tickerVal = document.getElementById('admin-ticker-msg-input').value.trim();
    const heroTitleVal = document.getElementById('admin-hero-title-input').value.trim();
    const heroSubtitleVal = document.getElementById('admin-hero-subtitle-input').value.trim();
    
    try {
        await supaClient.from('settings').upsert({ key: 'ticker_custom_message', value: tickerVal }, { onConflict: 'key' });
        STATE.tickerCustomMessage = tickerVal;
        
        await supaClient.from('settings').upsert({ key: 'hero_title', value: heroTitleVal }, { onConflict: 'key' });
        STATE.heroTitle = heroTitleVal;
        
        await supaClient.from('settings').upsert({ key: 'hero_subtitle', value: heroSubtitleVal }, { onConflict: 'key' });
        STATE.heroSubtitle = heroSubtitleVal;
        
        renderRatesTicker();
        renderHeroTextOverlay();
        
        alert("Banner and ticker announcement texts saved successfully!");
    } catch(err) {
        console.error("Error saving banner texts:", err);
        alert("Failed to save banner texts: " + err.message);
    }
}

async function saveAdminUpiId() {
    const upiInput = document.getElementById('admin-upi-id-input');
    if (!upiInput) return;
    const val = upiInput.value.trim();
    if (!val) {
        alert("Please enter a valid UPI ID.");
        return;
    }
    try {
        await supaClient.from('settings').upsert({ key: 'admin_upi_id', value: val }, { onConflict: 'key' });
        const upiDisplay = document.getElementById('checkout-upi-id-display');
        if (upiDisplay) upiDisplay.textContent = `UPI ID: ${val}`;
        showToast("UPI ID saved successfully.");
    } catch (err) {
        console.error("Error saving UPI ID:", err);
        alert("Failed to save UPI ID.");
    }
}

// Simple toast helper
function showToast(msg, duration = 3000) {
    const t = document.createElement('div');
    t.textContent = msg;
    Object.assign(t.style, {
        position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
        background: '#1a0a2e', color: '#fff', padding: '11px 22px',
        borderRadius: '30px', fontWeight: '600', zIndex: '99999', fontSize: '0.88rem',
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), duration);
}

function copyProductShareLink() {
    if (!STATE.selectedProduct) return;
    const url = `${window.location.origin}${window.location.pathname}?product=${STATE.selectedProduct.id}`;
    navigator.clipboard.writeText(url).then(() => {
        showToast("🔗 Product link copied to clipboard!");
    }).catch(err => {
        console.error("Failed to copy link:", err);
        showToast("❌ Failed to copy link.");
    });
}

// --- LIVE STATS FROM SUPABASE ---
async function loadLiveStats() {
    try {
        // Count delivered orders (status = 'delivered' or 'approved')
        const ordersRes = { ok: true, json: async () => ([]) };
        const allOrdersRes = { ok: true, json: async () => ([]) };
        const productsRes = { ok: true, json: async () => ([]) };

        let deliveredCount = 0;
        let customersCount = 0;
        let productsCount = 0;

        if (ordersRes.ok) {
            const delivered = await ordersRes.json();
            deliveredCount = delivered.length;
        }
        if (allOrdersRes.ok) {
            const allOrders = await allOrdersRes.json();
            // Count unique customers by phone/name
            const uniqueCustomers = new Set(allOrders.map(o => o.customer));
            customersCount = uniqueCustomers.size;
        }
        if (productsRes.ok) {
            const prods = await productsRes.json();
            productsCount = prods.length;
        }

        // Animate counter from 0 to target
        function animateCount(el, target, suffix = '') {
            if (!el) return;
            const duration = 1500;
            const step = Math.ceil(target / (duration / 16));
            let current = 0;
            const timer = setInterval(() => {
                current = Math.min(current + step, target);
                el.textContent = current.toLocaleString('en-IN') + suffix;
                if (current >= target) clearInterval(timer);
            }, 16);
        }

        animateCount(document.getElementById('stat-orders'), deliveredCount);
        animateCount(document.getElementById('stat-customers'), customersCount);
        animateCount(document.getElementById('stat-products'), productsCount);

    } catch (e) {
        // Silently fail — don't show errors to visitors
        console.warn('Stats load failed:', e);
    }
}

// --- WINDOW LOAD INITIALIZER ---
window.addEventListener("DOMContentLoaded", async () => { localStorage.removeItem("mock_db_settings"); 
    // Show home view IMMEDIATELY — don't wait for network
    const homeView = document.getElementById("home-view");
    if (homeView) homeView.classList.add("active-view");
    initTryOnDragAndDrop();
    renderRatesTicker();

    // Clear admin authentication state on fresh load / reload to enforce login prompt
    sessionStorage.removeItem("mrt_admin_authenticated");
    const btn = document.getElementById("admin-toggle");
    if (btn) btn.textContent = "Admin Panel";
    
    // Dynamic countdown timer for Flash Sale
    let hours = 4, minutes = 32, seconds = 15;
    const hourNode = document.getElementById("timer-hours");
    const minNode = document.getElementById("timer-mins");
    const secNode = document.getElementById("timer-secs");
    
    if (hourNode && minNode && secNode) {
        setInterval(() => {
            seconds--;
            if (seconds < 0) {
                seconds = 59;
                minutes--;
                if (minutes < 0) {
                    minutes = 59;
                    hours--;
                    if (hours < 0) {
                        hours = 24; // Reset loop
                    }
                }
            }
            hourNode.textContent = hours.toString().padStart(2, "0");
            minNode.textContent = minutes.toString().padStart(2, "0");
            secNode.textContent = seconds.toString().padStart(2, "0");
        }, 1000);
    }

    // Handle referral code in URL
    const urlParams = new URLSearchParams(window.location.search);
    let refCode = urlParams.get('ref');
    if (!refCode && window.location.hash.includes('ref=')) {
        const match = window.location.hash.match(/ref=([^&]+)/);
        if (match) refCode = match[1];
    }
    if (refCode) {
        const refInp = document.getElementById('auth-referral-code');
        if (refInp) {
            refInp.value = refCode.toUpperCase();
        }
        isAuthSignupMode = false;
        toggleAuthMode();
        openUserProfile();
    }

    // Load all data in background — re-render once ready
    initState().then(() => {
        renderHomeProducts();
        updateHeaderCounters();
        renderRatesTicker();

        const prodIdParam = urlParams.get('product') || (window.location.hash.match(/product=([^&]+)/) || [])[1];
        const hash = window.location.hash.replace("#", "");
        if (hash.startsWith("detail_")) {
            const prodId = hash.replace("detail_", "");
            const prod = STATE.products.find(p => p.id === prodId);
            if (prod) viewProductDetail(prod.id, true);
        } else if (prodIdParam) {
            const prod = STATE.products.find(p => p.id === prodIdParam);
            if (prod) viewProductDetail(prod.id, true);
        } else {
            const validViews = ["home", "shop", "customisation", "track", "shipping", "admin"];
            const hashView = window.location.hash.replace("#", "");
            if (validViews.includes(hashView)) {
                navigateTo(hashView, null, true);
            }
        }

        loadLiveStats();
        applyBannerImages();
    });
});

// Window popstate event listener for browser Back/Forward navigation
window.addEventListener("popstate", (event) => {
    if (event.state && event.state.viewId) {
        if (event.state.viewId === "detail" && event.state.selectedProductId) {
            viewProductDetail(event.state.selectedProductId, true);
        } else {
            navigateTo(event.state.viewId, event.state.preFilter, true);
        }
    } else {
        const hash = window.location.hash.replace("#", "");
        if (hash.startsWith("detail_")) {
            const prodId = hash.replace("detail_", "");
            viewProductDetail(prodId, true);
        } else {
            const validViews = ["home", "shop", "customisation", "track", "shipping", "admin"];
            if (validViews.includes(hash)) {
                navigateTo(hash, null, true);
            } else {
                navigateTo("home", null, true);
            }
        }
    }
});

// --- RECALCULATE ALL PRODUCT PRICES BASED ON LIVE RATES ---
function recalculateAllProductPrices() {
    console.log("Recalculating all product prices based on live metal rates...");
    if (!STATE.products || STATE.products.length === 0) return;

    STATE.products.forEach(p => {
        let specs = p.specs || {};
        if (specs.disable_auto_rate === true) {
            // Skip price recalculation for manually priced products!
            return;
        }
        let weightVal = parseFloat(specs.calc_weight);
        
        if (isNaN(weightVal) && specs.weight) {
            weightVal = parseFloat(specs.weight);
        }
        if (isNaN(weightVal)) {
            const cat = (p.category || "").toLowerCase();
            if (cat === "rings") weightVal = 3.0;
            else if (cat === "earrings") weightVal = 2.5;
            else if (cat === "pendants") weightVal = 3.5;
            else if (cat === "anklets") weightVal = 4.0;
            else if (cat === "chains" || cat === "chain_pendant") weightVal = 6.0;
            else if (cat === "coins") weightVal = 10.0;
            else if (cat === "gold_coins") weightVal = 5.0;
            else weightVal = 3.0;
        }

        let marketBase = specs.market_base;
        if (!marketBase) {
            const cat = (p.category || "").toLowerCase();
            const title = (p.title || "").toLowerCase();
            if (cat === "gold" || cat === "gold_coins" || title.includes("gold")) {
                marketBase = "gold";
            } else if (cat === "coins" || (specs.metal && specs.metal.includes("625"))) {
                marketBase = "fine";
            } else {
                marketBase = "sterling";
            }
        }

        let liveRate = STATE.rates.sterling;
        if (marketBase === "gold") {
            liveRate = STATE.rates.gold || 7500.00;
        } else if (marketBase === "fine") {
            liveRate = STATE.rates.fine;
        }

        const metalCost = weightVal * liveRate;

        let makingVal = parseFloat(specs.calc_making);
        let makingType = specs.calc_making_type;
        let gstVal = parseFloat(specs.calc_gst) || 3.0;

        if (isNaN(makingVal)) {
            makingType = "percentage";
            const cat = (p.category || "").toLowerCase();
            const title = (p.title || "").toLowerCase();
            const metalSpec = (specs.metal || "").toLowerCase();
            
            if (cat === "gold" || cat === "gold_coins" || title.includes("gold")) {
                makingVal = 160.0;
                makingType = "per-gram";
            } else if (cat === "coins" || title.includes("coin")) {
                makingVal = (8.0 / 245) * 100;
            } else if (marketBase === "fine" || metalSpec.includes("625")) {
                makingVal = (80.0 / 245) * 100;
            } else if (cat === "chains" || cat === "chain_pendant" || cat === "bracelets" || cat === "kada" || title.includes("chain") || title.includes("bracelet") || title.includes("kada")) {
                makingVal = (155.0 / 245) * 100;
            } else {
                makingVal = (405.0 / 245) * 100;
            }
        } else if (!makingType) {
            makingType = "per-gram";
        }

        let makingCost = 0;
        if (makingType === "percentage") {
            makingCost = metalCost * (makingVal / 100);
        } else if (makingType === "flat") {
            makingCost = makingVal;
        } else {
            makingCost = weightVal * makingVal;
        }

        const subtotal = metalCost + makingCost;
        const gstCost = subtotal * (gstVal / 100);
        const finalPrice = Math.round(subtotal + gstCost);

        p.price = finalPrice;
        p.originalPrice = finalPrice * 2;
    });

    if (STATE.cart && STATE.cart.length > 0) {
        let cartUpdated = false;
        STATE.cart.forEach(item => {
            const prod = STATE.products.find(p => p.id === item.id);
            if (prod) {
                const hasGiftWrap = item.title.includes("+ Gift Box");
                const newUnitPrice = prod.price + (hasGiftWrap ? 100 : 0);
                if (item.price !== newUnitPrice) {
                    item.price = newUnitPrice;
                    cartUpdated = true;
                }
            }
        });
        if (cartUpdated) {
            saveCart();
            renderCartDrawer();
        }
    }
}

// --- DYNAMIC RATE AUTO-CALCULATOR FOR INVENTORY UPLOADS ---
function autoCalculateJewelRate() {
    const disableCheckbox = document.getElementById("new-prod-disable-autorate");
    if (disableCheckbox && disableCheckbox.checked) {
        const breakdownDiv = document.getElementById("rate-calculation-breakdown");
        if (breakdownDiv) breakdownDiv.style.display = "none";
        return;
    }
    const weightVal = parseFloat(document.getElementById("new-prod-calc-weight").value);
    const makingInputVal = document.getElementById("new-prod-calc-making").value.trim();
    let makingVal = parseFloat(makingInputVal);
    let makingType = document.getElementById("new-prod-calc-making-type").value;
    const marketBase = document.getElementById("new-prod-market-base").value;
    
    let isAutoDefault = false;
    if (makingInputVal === "" || isNaN(makingVal)) {
        isAutoDefault = true;
        makingType = "percentage";
        const cat = document.getElementById("new-prod-cat").value.toLowerCase();
        const title = document.getElementById("new-prod-title").value.toLowerCase();
        
        if (marketBase === "gold") {
            makingVal = 160.0;
            makingType = "per-gram";
        } else if (cat === "coins" || title.includes("coin")) {
            makingVal = (8.0 / 245) * 100;
        } else if (marketBase === "fine") {
            makingVal = (80.0 / 245) * 100;
        } else if (cat === "chains" || cat === "chain_pendant" || cat === "bracelets" || cat === "kada" || title.includes("chain") || title.includes("bracelet") || title.includes("kada")) {
            makingVal = (155.0 / 245) * 100;
        } else {
            makingVal = (405.0 / 245) * 100;
        }
    }
    const gstVal = parseFloat(document.getElementById("new-prod-calc-gst").value) || 0;
    
    const priceInput = document.getElementById("new-prod-price");
    const origPriceInput = document.getElementById("new-prod-orig");
    const weightSpecInput = document.getElementById("new-prod-weight");
    const breakdownDiv = document.getElementById("rate-calculation-breakdown");
    
    if (isNaN(weightVal) || weightVal <= 0) {
        if (breakdownDiv) breakdownDiv.style.display = "none";
        return;
    }
    
    // Choose live rate depending on dropdown value
    let liveRate = STATE.rates.sterling;
    if (marketBase === "gold") {
        liveRate = STATE.rates.gold || 7500.00;
    } else if (marketBase === "fine") {
        liveRate = STATE.rates.fine;
    }
    
    const metalCost = weightVal * liveRate;
    
    // Calculate making charges: flat per gram vs percentage of metal cost
    let makingCost = 0;
    let makingText = "";
    if (makingType === "percentage") {
        makingCost = metalCost * (makingVal / 100);
        makingText = `Making Charges (${makingVal}% of Metal Cost): ₹${makingCost.toFixed(2)}`;
    } else if (makingType === "flat") {
        makingCost = makingVal;
        makingText = `Making Charges (Flat Rate): ₹${makingCost.toFixed(2)}`;
    } else {
        makingCost = weightVal * makingVal;
        makingText = `Making Charges (${weightVal}g @ ₹${makingVal.toFixed(2)}/g): ₹${makingCost.toFixed(2)}`;
    }
    
    const subtotal = metalCost + makingCost;
    const gstCost = subtotal * (gstVal / 100);
    const totalCost = Math.round(subtotal + gstCost);
    
    if (priceInput) priceInput.value = totalCost;
    if (origPriceInput) origPriceInput.value = totalCost * 2;
    if (weightSpecInput) weightSpecInput.value = `${weightVal} grams`;
    
    if (breakdownDiv) {
        breakdownDiv.style.display = "block";
        breakdownDiv.innerHTML = `
            <strong>Auto-Calculation Breakdown:</strong><br>
            • Metal Cost (${weightVal}g @ ₹${liveRate.toFixed(2)}/g for ${marketBase === 'gold' ? '24K Gold Purity' : (marketBase === 'fine' ? '999 Fine Purity' : '925 Sterling Purity')}): ₹${metalCost.toFixed(2)}<br>
            • ${makingText}<br>
            • Subtotal: ₹${subtotal.toFixed(2)}<br>
            • GST (${gstVal}%): ₹${gstCost.toFixed(2)}<br>
            • <strong>Final Calculated Price: ₹${totalCost}</strong> (Original Price set to ₹${totalCost * 2})
        `;
    }
}

// Toggle enabled/disabled state of auto-rate calculator fields
function toggleAutoRateFields() {
    const isChecked = document.getElementById("new-prod-disable-autorate").checked;
    const fields = [
        "new-prod-calc-weight",
        "new-prod-calc-making",
        "new-prod-calc-making-type",
        "new-prod-market-base"
    ];
    
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = isChecked;
            el.style.opacity = isChecked ? "0.5" : "1";
        }
    });

    // Make sure GST field stays enabled for manual GST calculation
    const gstEl = document.getElementById("new-prod-calc-gst");
    if (gstEl) {
        gstEl.disabled = false;
        gstEl.style.opacity = "1";
    }

    const manualFields = [
        "new-prod-weight",
        "new-prod-price",
        "new-prod-orig"
    ];
    
    manualFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.readOnly = !isChecked;
            el.style.backgroundColor = !isChecked ? "#f1f5f9" : "";
        }
    });
    
    const priceInput = document.getElementById("new-prod-price");
    const labelPrice = document.querySelector('label[for="new-prod-price"]') || (priceInput ? priceInput.previousElementSibling : null);
    
    if (isChecked) {
        if (labelPrice) labelPrice.textContent = "Manual Base Price (before GST) ₹ INR";
        if (priceInput) {
            priceInput.placeholder = "Enter manual base price (before GST)";
            priceInput.addEventListener('input', runManualGstCalculation);
        }
        const gstInput = document.getElementById("new-prod-calc-gst");
        if (gstInput) {
            gstInput.addEventListener('input', runManualGstCalculation);
        }
        runManualGstCalculation();
    } else {
        if (labelPrice) labelPrice.textContent = "Price (₹ INR)";
        if (priceInput) {
            priceInput.placeholder = "Price (calculated or manual)";
            priceInput.removeEventListener('input', runManualGstCalculation);
        }
        const gstInput = document.getElementById("new-prod-calc-gst");
        if (gstInput) {
            gstInput.removeEventListener('input', runManualGstCalculation);
            gstInput.addEventListener('input', autoCalculateJewelRate);
        }
        const breakdown = document.getElementById("rate-calculation-breakdown");
        if (breakdown) breakdown.style.display = "none";
        autoCalculateJewelRate();
    }
}

function runManualGstCalculation() {
    const isChecked = document.getElementById("new-prod-disable-autorate").checked;
    if (!isChecked) return;
    
    const basePrice = parseFloat(document.getElementById("new-prod-price").value);
    const gstVal = parseFloat(document.getElementById("new-prod-calc-gst").value) || 3;
    const breakdownDiv = document.getElementById("rate-calculation-breakdown");
    
    if (isNaN(basePrice) || basePrice <= 0) {
        if (breakdownDiv) breakdownDiv.style.display = "none";
        return;
    }
    
    const finalPrice = basePrice;
    const gstCost = finalPrice * (gstVal / (100 + gstVal));
    const baseBeforeGst = finalPrice - gstCost;
    
    // Auto update the original price preview to finalPrice * 2
    const origPriceInput = document.getElementById("new-prod-orig");
    if (origPriceInput) origPriceInput.value = finalPrice * 2;
    
    if (breakdownDiv) {
        breakdownDiv.style.display = "block";
        breakdownDiv.style.backgroundColor = "var(--color-accent-pink-light)";
        breakdownDiv.style.borderLeft = "4px solid var(--color-accent-pink)";
        breakdownDiv.style.color = "var(--color-primary)";
        breakdownDiv.innerHTML = `
            <strong>Manual Price (GST Included) Breakdown:</strong><br>
            • <strong>Final Stored Price (GST Inclusive): ₹${finalPrice.toLocaleString("en-IN")}</strong><br>
            • Taxable Base Price (Before GST): ₹${Math.round(baseBeforeGst).toLocaleString("en-IN")}<br>
            • GST (${gstVal}%): ₹${gstCost.toFixed(2)}<br>
            • Original Price (Crossed Price): ₹${(finalPrice * 2).toLocaleString("en-IN")}
        `;
    }
}

// --- FILE LOADER BASE64 CONVERTER ---
function previewUploadedImage(input) {
    const file = input.files[0];
    const previewWrap = document.getElementById("new-prod-img-preview-wrap");
    const previewImg = document.getElementById("new-prod-img-preview");
    const base64Input = document.getElementById("new-prod-img-base64");
    
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            if (previewImg) previewImg.src = e.target.result;
            if (previewWrap) previewWrap.style.display = "block";
            if (base64Input) base64Input.value = e.target.result;
        };
        reader.readAsDataURL(file);
    } else {
        if (previewImg) previewImg.src = "";
        if (previewWrap) previewWrap.style.display = "none";
        if (base64Input) base64Input.value = "";
    }
}

// --- PRODUCT EDITING LOGIC ---
function editProduct(prodId) {
    const p = STATE.products.find(item => item.id === prodId);
    if (!p) return;
    
    // Set editing state
    STATE.editingProductId = prodId;
    
    // Populate form fields
    document.getElementById("new-prod-title").value = p.title;
    document.getElementById("new-prod-cat").value = p.category;
    if (document.getElementById("new-prod-gender")) document.getElementById("new-prod-gender").value = p.gender || "both";
    document.getElementById("new-prod-price").value = p.price || "";
    document.getElementById("new-prod-orig").value = p.originalPrice || "";
    document.getElementById("new-prod-finish").value = p.plating;
    
    // Infer market purity base from specs.metal
    const metalSpec = (p.specs && p.specs.metal) ? p.specs.metal.toLowerCase() : "";
    if (p.specs && p.specs.market_base) {
        document.getElementById("new-prod-market-base").value = p.specs.market_base;
    } else if (metalSpec.includes("gold")) {
        document.getElementById("new-prod-market-base").value = "gold";
    } else if (metalSpec.includes("625") || metalSpec.includes("fine")) {
        document.getElementById("new-prod-market-base").value = "fine";
    } else {
        document.getElementById("new-prod-market-base").value = "sterling";
    }
    
    document.getElementById("new-prod-width").value = (p.specs && p.specs.width) ? p.specs.width : "";
    if (document.getElementById("new-prod-available-sizes")) {
        document.getElementById("new-prod-available-sizes").value = (p.specs && p.specs.available_sizes) ? p.specs.available_sizes : "";
    }
    document.getElementById("new-prod-desc").value = p.description || "";
    
    // Image base64 and preview
    document.getElementById("new-prod-img-base64").value = p.image || "";
    const previewWrap = document.getElementById("new-prod-img-preview-wrap");
    const previewImg = document.getElementById("new-prod-img-preview");
    if (p.image) {
        if (previewImg) previewImg.src = p.image;
        if (previewWrap) previewWrap.style.display = "block";
    } else {
        if (previewImg) previewImg.src = "";
        if (previewWrap) previewWrap.style.display = "none";
    }
    
    // Weight spec and calculator weight
    let weightVal = 0;
    if (p.specs && p.specs.calc_weight !== undefined) {
        weightVal = p.specs.calc_weight;
    } else if (p.specs && p.specs.weight) {
        weightVal = parseFloat(p.specs.weight);
    }
    document.getElementById("new-prod-weight").value = (p.specs && p.specs.weight) ? p.specs.weight : "";
    document.getElementById("new-prod-calc-weight").value = isNaN(weightVal) || weightVal === 0 ? "" : weightVal;
    
    // Load dynamic pricing calculator parameters if available
    const disableCheckbox = document.getElementById("new-prod-disable-autorate");
    if (disableCheckbox) {
        disableCheckbox.checked = !!(p.specs && p.specs.disable_auto_rate);
    }
    toggleAutoRateFields();

    if (p.specs && p.specs.calc_making !== undefined) {
        document.getElementById("new-prod-calc-making").value = p.specs.calc_making;
        document.getElementById("new-prod-calc-making-type").value = p.specs.calc_making_type || "per-gram";
        document.getElementById("new-prod-calc-gst").value = p.specs.calc_gst !== undefined ? p.specs.calc_gst : "3";
        if (!p.specs.disable_auto_rate) {
            autoCalculateJewelRate();
        }
    } else {
        document.getElementById("new-prod-calc-making").value = "";
        document.getElementById("new-prod-calc-making-type").value = "per-gram";
        document.getElementById("new-prod-calc-gst").value = "3";
        const breakdown = document.getElementById("rate-calculation-breakdown");
        if (breakdown) {
            breakdown.innerHTML = "";
            breakdown.style.display = "none";
        }
    }
    
    // Prices
    if (p.specs && p.specs.disable_auto_rate) {
        let basePrice = p.specs.manual_base_price;
        if (basePrice === undefined) {
            const gstVal = parseFloat(p.specs.calc_gst) || 3;
            basePrice = Math.round(p.price / (1 + gstVal / 100));
        }
        document.getElementById("new-prod-price").value = basePrice || "";
        document.getElementById("new-prod-orig").value = p.originalPrice || "";
        runManualGstCalculation();
    } else {
        document.getElementById("new-prod-price").value = p.price || "";
        document.getElementById("new-prod-orig").value = p.originalPrice || "";
    }
    document.getElementById("new-prod-stock").value = p.inStock ? "true" : "false";
    document.getElementById("new-prod-qty").value = (p.specs && p.specs.stock_qty !== undefined) ? p.specs.stock_qty : (p.inStock ? 10 : 0);
    
    // Update heading and submit button text
    const titleHeader = document.getElementById("admin-add-tab-title");
    if (titleHeader) titleHeader.textContent = `Edit Silver Jewel: ${p.title}`;
    
    const submitBtn = document.getElementById("admin-add-btn");
    if (submitBtn) {
        submitBtn.textContent = "Save Changes";
        submitBtn.setAttribute("onclick", "updateExistingProduct()");
    }
    
    // Add "Cancel Edit" button if it doesn't exist
    let actionsContainer = document.getElementById("admin-add-actions");
    if (actionsContainer) {
        let cancelBtn = document.getElementById("admin-cancel-edit-btn");
        if (!cancelBtn) {
            cancelBtn = document.createElement("button");
            cancelBtn.id = "admin-cancel-edit-btn";
            cancelBtn.className = "admin-btn-submit";
            cancelBtn.style.backgroundColor = "var(--color-silver-mid)";
            cancelBtn.style.color = "var(--color-primary)";
            cancelBtn.style.marginTop = "0";
            cancelBtn.style.flex = "1";
            cancelBtn.textContent = "Cancel Edit";
            cancelBtn.onclick = cancelEditProduct;
            actionsContainer.appendChild(cancelBtn);
        }
    }
    
    // Navigate to the form tab
    navigateAdminTab('add');
}

async function updateExistingProduct() {
    if (!STATE.editingProductId) return;
    
    const submitBtn = document.querySelector('button[onclick="updateExistingProduct()"]');
    if (submitBtn) submitBtn.innerHTML = "Uploading & Saving...";
    if (submitBtn) submitBtn.disabled = true;

    const title = document.getElementById("new-prod-title").value.trim();
    const category = document.getElementById("new-prod-cat").value;
    const gender = document.getElementById("new-prod-gender") ? document.getElementById("new-prod-gender").value : "both";
    
    const basePrice = parseFloat(document.getElementById("new-prod-price").value);
    const isManual = document.getElementById("new-prod-disable-autorate").checked;
    const gstVal = parseFloat(document.getElementById("new-prod-calc-gst").value) || 3;
    
    let price = basePrice;
    let manualBasePrice = undefined;
    if (isManual) {
        manualBasePrice = Math.round(basePrice * 100 / (100 + gstVal));
        price = basePrice;
    }
    const origPrice = parseFloat(document.getElementById("new-prod-orig").value) || price * 2;
    let image = document.getElementById("new-prod-img-base64").value || "https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=600&q=80";
    const plating = document.getElementById("new-prod-finish").value;
    const desc = document.getElementById("new-prod-desc").value.trim() || "Genuine 925 sterling silver exquisite ornament piece.";
    
    const weight = document.getElementById("new-prod-weight").value.trim() || "2.5 grams";
    const width = document.getElementById("new-prod-width").value.trim() || "N/A";
    const stockQty = parseInt(document.getElementById("new-prod-qty").value) || 0;
    const inStock = stockQty > 0 && document.getElementById("new-prod-stock").value === "true";
    
    if (!title || isNaN(basePrice) || basePrice <= 0) {
        alert("Please enter a valid Product Title and Base Price.");
        if (submitBtn) submitBtn.innerHTML = "Save Changes";
        if (submitBtn) submitBtn.disabled = false;
        return;
    }
    
    const idx = STATE.products.findIndex(p => p.id === STATE.editingProductId);
    if (idx === -1) {
        alert("Error: Product to edit not found.");
        cancelEditProduct();
        if (submitBtn) submitBtn.innerHTML = "Save Changes";
        if (submitBtn) submitBtn.disabled = false;
        return;
    }
    
    // Process Supabase Storage Upload for edit
    const fileInput = document.getElementById("new-prod-img-file");
    if (fileInput && fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.floor(Math.random() * 1000)}.${fileExt}`;
        
        const { data: uploadData, error: uploadError } = await supaClient.storage
            .from('product-images')
            .upload(fileName, file, { contentType: file.type });
            
        if (uploadError) {
            console.error("Storage upload error", uploadError);
            alert("Failed to upload new image. Retaining current image.");
            image = STATE.products[idx].image;
        } else if (uploadData) {
            const { data: publicUrlData } = supaClient.storage.from('product-images').getPublicUrl(fileName);
            image = publicUrlData.publicUrl;
        }
    } else {
        if (!image || image === "https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=600&q=80") {
            image = STATE.products[idx].image;
        }
    }
    
    // Update the product fields, retaining rating & reviews
    const existingProduct = STATE.products[idx];
    
    const updatedProduct = {
        ...existingProduct,
        title: title,
        category: category,
        gender: gender,
        price: price,
        originalPrice: origPrice,
        plating: plating,
        inStock: inStock,
        image: image,
        description: desc,
        specs: {
            ...existingProduct.specs,
            metal: document.getElementById("new-prod-market-base").value === "gold" ? "24K Gold" : (document.getElementById("new-prod-market-base").value === "fine" ? "625 Silver" : "925 Sterling Silver"),
            weight: weight,
            width: width,
            calc_weight: parseFloat(document.getElementById("new-prod-calc-weight").value),
            calc_making: parseFloat(document.getElementById("new-prod-calc-making").value) || 0,
            calc_making_type: document.getElementById("new-prod-calc-making-type").value,
            calc_gst: gstVal,
            market_base: document.getElementById("new-prod-market-base").value,
            disable_auto_rate: isManual,
            manual_base_price: manualBasePrice,
            stock_qty: stockQty,
            available_sizes: document.getElementById("new-prod-available-sizes") ? document.getElementById("new-prod-available-sizes").value.trim() : "",
            gender: gender
        }
    };
    
    STATE.products[idx] = updatedProduct;
    
    const dbProduct = {
        id: updatedProduct.id,
        title: updatedProduct.title,
        category: updatedProduct.category,
        price: updatedProduct.price,
        original_price: updatedProduct.originalPrice,
        rating: updatedProduct.rating,
        reviews_count: updatedProduct.reviewsCount,
        plating: updatedProduct.plating,
        in_stock: updatedProduct.inStock,
        image: updatedProduct.image,
        description: updatedProduct.description,
        specs: updatedProduct.specs
    };
    
    try {
        const { error } = await supaClient.from('products').upsert([dbProduct]);
        if (error) throw error;
        alert(`Success! Product "${title}" has been updated in Supabase.`);
    } catch (err) {
        console.error("Supabase product update error:", err);
        alert(`Product updated locally, but failed to save to Supabase: ${err.message}`);
    }
    
    if (submitBtn) {
        submitBtn.innerHTML = "Save Changes";
        submitBtn.disabled = false;
    }
    
    cancelEditProduct();
    renderAdminInventoryList();
}

function cancelEditProduct() {
    // Reset state ID
    STATE.editingProductId = null;
    
    // Clear forms
    document.getElementById("new-prod-title").value = "";
    if (document.getElementById("new-prod-gender")) document.getElementById("new-prod-gender").value = "both";
    document.getElementById("new-prod-price").value = "";
    document.getElementById("new-prod-orig").value = "";
    document.getElementById("new-prod-img-file").value = "";
    document.getElementById("new-prod-img-base64").value = "";
    document.getElementById("new-prod-finish").value = "silver";
    document.getElementById("new-prod-stock").value = "true";
    document.getElementById("new-prod-qty").value = "10";
    
    const previewWrap = document.getElementById("new-prod-img-preview-wrap");
    if (previewWrap) previewWrap.style.display = "none";
    const previewImg = document.getElementById("new-prod-img-preview");
    if (previewImg) previewImg.src = "";
    
    document.getElementById("new-prod-weight").value = "";
    document.getElementById("new-prod-width").value = "";
    document.getElementById("new-prod-desc").value = "";
    
    // Clear calculation helper inputs
    const calcWeight = document.getElementById("new-prod-calc-weight");
    const calcMaking = document.getElementById("new-prod-calc-making");
    const calcMakingType = document.getElementById("new-prod-calc-making-type");
    const calcGst = document.getElementById("new-prod-calc-gst");
    const breakdown = document.getElementById("rate-calculation-breakdown");
    
    if (calcWeight) calcWeight.value = "";
    if (calcMaking) calcMaking.value = "";
    if (calcMakingType) calcMakingType.value = "per-gram";
    if (calcGst) calcGst.value = "3";
    if (breakdown) {
        breakdown.innerHTML = "";
        breakdown.style.display = "none";
    }
    const disableCheckbox = document.getElementById("new-prod-disable-autorate");
    if (disableCheckbox) disableCheckbox.checked = false;
    toggleAutoRateFields();
    
    // Restore header & submit button
    const titleHeader = document.getElementById("admin-add-tab-title");
    if (titleHeader) titleHeader.textContent = "Upload New Silver Jewel";
    
    const submitBtn = document.getElementById("admin-add-btn");
    if (submitBtn) {
        submitBtn.textContent = "Save Jewel to active Catalog";
        submitBtn.setAttribute("onclick", "addNewProduct()");
    }
    
    // Remove "Cancel Edit" button
    const cancelBtn = document.getElementById("admin-cancel-edit-btn");
    if (cancelBtn) {
        cancelBtn.remove();
    }
    
    // Switch view back to catalog list
    navigateAdminTab('inventory');
}

// --- BESPOKE CUSTOMISATION PAGE FUNCTIONS ---

function renderCustomisationPage() {
    renderCustomisedCreations();
}

function renderCustomisedCreations() {
    const grid = document.getElementById("customised-products-grid");
    if (!grid) return;

    // Filter products to show only "customised" category
    const customisedProducts = STATE.products.filter(p => p.category === "customised");

    if (customisedProducts.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--color-silver-dark);">
                <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="margin-bottom:12px;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"></path></svg>
                <p style="font-weight:600;font-size:1.1rem;margin-bottom:4px;">No Customized Masterpieces Uploaded</p>
                <p style="font-size:0.85rem;">Check back later or contact us to order bespoke silver pieces!</p>
            </div>
        `;
    } else {
        grid.innerHTML = customisedProducts.map((p, idx) => createProductCardHtml(p, idx)).join("");
    }
}

// --- INFORMATIONAL PAGES INTERACTIVE FUNCTIONS ---

function showStampDetail(mark) {
    const title = document.getElementById("stamp-detail-title");
    const desc = document.getElementById("stamp-detail-desc");
    if (!title || !desc) return;
    
    const details = {
        logo: {
            title: "1. BIS Triangle Logo",
            desc: "The Bureau of Indian Standards (BIS) logo is the official government mark certifying that the jewelry has been assayed and verified for purity at an authorized center."
        },
        purity: {
            title: "2. Purity Grade (925 / Sterling)",
            desc: "Represents 92.5% pure solid silver. This is the global standard for fine silver jewelry, offering the perfect balance of brilliant luster and physical strength."
        },
        assay: {
            title: "3. Assaying Centre Mark",
            desc: "The unique logo or code of the government-licensed Assaying & Hallmarking Centre where the silver purity of this specific batch was laboratory tested."
        },
        jeweller: {
            title: "4. Jeweller's Identification Mark",
            desc: "UVIRA's official identification mark (stamped as 'UVIRA'), guaranteeing that this piece was handcrafted by UVIRA JEWELS and conforms to our strict quality standards."
        }
    };
    
    if (details[mark]) {
        title.textContent = details[mark].title;
        desc.textContent = details[mark].desc;
        
        const marks = document.querySelectorAll(".stamp-mark");
        marks.forEach(m => {
            if (m.getAttribute("data-mark") === mark) {
                m.classList.add("highlighted");
            } else {
                m.classList.remove("highlighted");
            }
        });
    }
}

function checkAllergy(issue) {
    const box = document.getElementById("allergy-result-box");
    const title = document.getElementById("allergy-result-title");
    const desc = document.getElementById("allergy-result-desc");
    if (!box || !title || !desc) return;
    
    box.style.display = "block";
    box.style.animation = "fadeIn 0.4s ease";
    
    let heading = "";
    let solution = "";
    
    if (issue === 'rash') {
        heading = "The Cause: Nickel Contact Dermatitis";
        solution = "Most cheap fashion jewelry is made of brass or base metals plated with Nickel. When you sweat, nickel salts dissolve and absorb into the skin, triggering red rashes and itching. \n\nOur Solution: UVIRA JEWELS jewelry is 100% Nickel-Free. We use pure 925 sterling silver alloyed only with copper, and shield it under luxury Rhodium plating (platinum family) so nickel never touches your skin.";
    } else if (issue === 'green') {
        heading = "The Cause: Acidic Copper Oxidation";
        solution = "Cheap alloys release copper or copper oxides that react with the acids and oils in your skin, leaving a harmless but unsightly green or dark stain. \n\nOur Solution: All our rings are finished with mirror-polished Rhodium plating or 18K Yellow Gold plating, creating a solid barrier that prevents copper oxidation and keeps your fingers clean and bright.";
    } else if (issue === 'itch') {
        heading = "The Cause: Lead & Heavy Metal Irritants";
        solution = "To lower costs, cheap alloys often contain high levels of Lead or Cadmium. These toxic heavy metals irritate delicate skin piercings, leading to swelling, throbbing, or infection.\n\nOur Solution: We strictly enforce Lead-Free and Cadmium-Free fabrication. Our lab-certified 925 sterling silver is biocompatible and safe even for fresh or highly sensitive ear piercings.";
    }
    
    title.textContent = heading;
    desc.innerHTML = solution.replace(/\n\n/g, '<br><br>');
    
    const btns = document.querySelectorAll(".allergy-quiz-btn");
    btns.forEach(btn => {
        if (btn.getAttribute("onclick").includes(issue)) {
            btn.classList.add("active-quiz-btn");
        } else {
            btn.classList.remove("active-quiz-btn");
        }
    });
}

function estimateDeliveryTime() {
    const input = document.getElementById("pincode-input");
    const box = document.getElementById("pincode-result-box");
    const title = document.getElementById("pincode-result-title");
    const desc = document.getElementById("pincode-result-desc");
    if (!input || !box || !title || !desc) return;
    
    const pin = input.value.trim();
    if (!/^\d{6}$/.test(pin)) {
        box.style.display = "block";
        box.style.backgroundColor = "#FEE2E2";
        box.style.border = "1px solid #EF4444";
        title.style.color = "#991B1B";
        title.textContent = "Invalid Pincode";
        desc.textContent = "Please enter a valid 6-digit Indian Pincode (e.g., 560001, 110001).";
        return;
    }
    
    box.style.display = "block";
    box.style.backgroundColor = "var(--color-accent-pink-light)";
    box.style.border = "1px solid var(--color-accent-pink)";
    title.style.color = "var(--color-accent-pink)";
    
    const metroPrefixes = ["11", "40", "56", "60", "70", "50"]; // Delhi, Mumbai, Bangalore, Chennai, Kolkata, Hyderabad
    const prefix = pin.substring(0, 2);
    
    if (metroPrefixes.includes(prefix)) {
        title.textContent = "⚡ Express Delivery: 2 - 3 Business Days";
        desc.innerHTML = `Great news! Pincode <strong>${pin}</strong> qualifies for Express Delivery.<br>
            • <strong>Courier Partners:</strong> BlueDart Express, Delhivery Air.<br>
            • <strong>Insured Shipping:</strong> Fully covered against loss or damage in transit.<br>
            • <strong>Status:</strong> Dispatched within 24 hours of confirmation.`;
    } else {
        title.textContent = "📦 Standard Delivery: 3 - 5 Business Days";
        desc.innerHTML = `Pincode <strong>${pin}</strong> qualifies for standard secure delivery.<br>
            • <strong>Courier Partners:</strong> Xpressbees, Delhivery Surface, India Post (Speed Post).<br>
            • <strong>Insured Shipping:</strong> Fully covered against loss or damage in transit.<br>
            • <strong>Status:</strong> Dispatched within 24 hours of confirmation.`;
    }
}

// --- GST CALCULATOR PORTAL FUNCTIONS ---

function calculateOrderGstAndShipping(o) {
    const itemsArr = typeof o.items === 'string' ? safeJSONParse(o.items, []) : (o.items || []);
    let digiSubtotal = 0;
    let physicalSubtotal = 0;
    
    itemsArr.forEach(item => {
        const isDigi = item.isDigiSilver || (item.title && item.title.toLowerCase().includes('digi silver'));
        if (isDigi) {
            digiSubtotal += (item.price * (item.qty || 1));
        } else {
            physicalSubtotal += (item.price * (item.qty || 1));
        }
    });
    
    const discount = parseFloat(o.discount) || 0;
    const total = parseFloat(o.total) || 0;
    
    // Digi GST is 3% added extra on the price
    const digiGst = Math.round(digiSubtotal * 0.03);
    
    // Physical GST is 3% inclusive in the price (after discount)
    const physicalTaxableBase = Math.max(0, physicalSubtotal - discount);
    const physicalGst = Math.round(physicalTaxableBase * 3 / 103);
    
    const gstTotal = physicalGst + digiGst;
    
    const expectedTotalWithoutShipping = physicalTaxableBase + digiSubtotal + digiGst;
    let shippingFee = 0;
    if (physicalSubtotal > 0) {
        if (Math.abs(total - expectedTotalWithoutShipping - 150) < 5) {
            shippingFee = 150;
        }
    }
    
    const cgst = (gstTotal / 2).toFixed(2);
    const sgst = (gstTotal / 2).toFixed(2);
    const taxableAmount = ((physicalTaxableBase - physicalGst) + digiSubtotal).toFixed(2);
    
    return {
        gstTotal,
        shippingFee,
        cgst,
        sgst,
        taxableAmount,
        digiSubtotal,
        physicalSubtotal
    };
}

function renderAdminGstPortal() {
    const monthSelect = document.getElementById("gst-month-select");
    const grossNode = document.getElementById("gst-stat-gross");
    const taxNode = document.getElementById("gst-stat-tax");
    const countNode = document.getElementById("gst-stat-count");
    const tbody = document.getElementById("admin-gst-tbody");
    
    if (!grossNode || !taxNode || !countNode || !tbody) return;
    
    const currentSelection = monthSelect ? monthSelect.value : "all";
    
    // 1. Populate month select options dynamically based on orders
    if (monthSelect) {
        // Find all unique YYYY-MM from order dates
        const months = new Set();
        STATE.orders.forEach(o => {
            if (o.date) {
                const parts = o.date.split("-");
                if (parts.length >= 2) {
                    months.add(`${parts[0]}-${parts[1]}`); // YYYY-MM
                }
            }
        });
        
        // Sort months descending
        const sortedMonths = Array.from(months).sort().reverse();
        
        // Helper to format YYYY-MM to readable name e.g. "June 2026"
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        let selectHtml = `<option value="all">All Months (Show All)</option>`;
        sortedMonths.forEach(m => {
            const [year, monthNum] = m.split("-");
            const readableName = `${monthNames[parseInt(monthNum, 10) - 1]} ${year}`;
            selectHtml += `<option value="${m}">${readableName}</option>`;
        });
        
        monthSelect.innerHTML = selectHtml;
        monthSelect.value = currentSelection;
        
        // If current selection is no longer valid, default to all
        if (monthSelect.value !== currentSelection) {
            monthSelect.value = "all";
        }
    }
    
    const selectedMonth = monthSelect ? monthSelect.value : "all";
    
    // 2. Filter orders
    let filtered = [...STATE.orders];
    if (selectedMonth !== "all") {
        filtered = filtered.filter(o => o.date && o.date.startsWith(selectedMonth));
    }
    
    // Sort orders by date descending
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // 3. Calculate metrics
    let grossSum = 0;
    let taxSum = 0;
    
    const tableHtml = filtered.map(o => {
        const taxDetails = calculateOrderGstAndShipping(o);
        const gst = taxDetails.gstTotal;
        grossSum += (o.total - gst);
        taxSum += gst;
        
        const customerName = getCustomerName(o.customer);
        
        return `
            <tr>
                <td style="font-weight:600;">${o.date}</td>
                <td style="font-family:monospace;font-size:0.85rem;">${o.id}</td>
                <td>${customerName}</td>
                <td>₹${(o.total - gst).toLocaleString("en-IN")}</td>
                <td style="color:var(--color-accent-pink);font-weight:600;">₹${gst.toLocaleString("en-IN")}</td>
                <td style="font-size:0.75rem;text-transform:uppercase;">${o.paymentMethod || o.payment_method || 'COD'}</td>
                <td style="text-align: center;">
                    <button class="btn-checkout" onclick="downloadOrderInvoicePdf('${o.id}')" style="padding: 4px 8px; font-size: 0.68rem; margin-top: 0; background: linear-gradient(135deg, #1A365D 0%, #2A4365 100%); color: #FFFFFF; border: none; border-radius: 4px; cursor: pointer;">
                        📄 PDF
                    </button>
                </td>
            </tr>
        `;
    }).join("");
    
    grossNode.textContent = `₹${Math.round(grossSum).toLocaleString("en-IN")}`;
    taxNode.textContent = `₹${Math.round(taxSum).toLocaleString("en-IN")}`;
    countNode.textContent = filtered.length;
    
    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align:center;padding:30px;color:var(--color-silver-dark);">
                    No orders found in the selected period.
                </td>
            </tr>
        `;
    } else {
        tbody.innerHTML = tableHtml;
    }
}

function downloadGstReportCsv() {
    const monthSelect = document.getElementById("gst-month-select");
    const selectedVal = monthSelect ? monthSelect.value : "all";
    
    let filteredOrders = [...STATE.orders];
    if (selectedVal !== "all") {
        filteredOrders = filteredOrders.filter(o => o.date && o.date.startsWith(selectedVal));
    }
    
    // Sort descending
    filteredOrders.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Create CSV header
    let csvContent = "Order ID,Date,Customer Name,Phone,Payment Method,Total Amount (INR),GST Recieved (3% INR),Taxable Value (INR)\r\n";
    
    let totalSales = 0;
    let totalGst = 0;
    let totalTaxable = 0;
    
    filteredOrders.forEach(o => {
        const taxDetails = calculateOrderGstAndShipping(o);
        const gst = taxDetails.gstTotal;
        const taxable = o.total - gst;
        const customerName = getCustomerName(o.customer);
        const cleanCustomer = String(customerName).replace(/"/g, '""');
        csvContent += `"${o.id}","${o.date}","${cleanCustomer}","${o.phone}","${o.paymentMethod || o.payment_method || 'COD'}",${o.total},${gst},${taxable}\r\n`;
        totalSales += o.total;
        totalGst += gst;
        totalTaxable += taxable;
    });
    
    // Add summary row at bottom
    csvContent += `\r\n"Total Summary",,,,${totalSales},${totalGst},${totalTaxable}\r\n`;
    
    // Trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    
    // Determine readable file name
    const filename = selectedVal === "all" ? "GST_Report_All_Time.csv" : `GST_Report_${selectedVal}.csv`;
    
    if (navigator.msSaveBlob) { // IE 10+
        navigator.msSaveBlob(blob, filename);
    } else {
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

function exportProductsToCSV() {
    if (!STATE.products || STATE.products.length === 0) {
        alert("No product data available to export.");
        return;
    }
    
    // Create CSV header
    let csvContent = "Product ID,Title,Category,Gender,Price (INR),Original Price (INR),In Stock,Plating,Weight,Width,Available Sizes,Description,Image URL\r\n";
    
    STATE.products.forEach(p => {
        const id = p.id || "";
        const title = String(p.title || "").replace(/"/g, '""');
        const category = String(p.category || "").replace(/"/g, '""');
        const gender = String(p.gender || "").replace(/"/g, '""');
        const price = p.price || 0;
        const originalPrice = p.originalPrice || 0;
        const inStock = p.inStock ? "Yes" : "No";
        const plating = String(p.plating || "").replace(/"/g, '""');
        
        const weight = (p.specs && p.specs.weight) ? String(p.specs.weight).replace(/"/g, '""') : "";
        const width = (p.specs && p.specs.width) ? String(p.specs.width).replace(/"/g, '""') : "";
        const availableSizes = (p.specs && p.specs.available_sizes) ? String(p.specs.available_sizes).replace(/"/g, '""') : "";
        const description = String(p.description || "").replace(/"/g, '""').replace(/\r?\n|\r/g, " ");
        const imageUrl = p.image || "";
        
        csvContent += `"${id}","${title}","${category}","${gender}",${price},${originalPrice},"${inStock}","${plating}","${weight}","${width}","${availableSizes}","${description}","${imageUrl}"\r\n`;
    });
    
    // Trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const filename = "UVIRAJEWELS_Inventory_Export.csv";
    
    if (navigator.msSaveBlob) { // IE 10+
        navigator.msSaveBlob(blob, filename);
    } else {
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// --- AI VIRTUAL TRY-ON FUNCTIONS ---

let STATE_TRYON_BASE64 = "";
let STATE_TRYON_RESULT_URL = "";
let STATE_TRYON_MODE = "overlay"; // "overlay" or "ai"
let STATE_TRYON_DRAG_ACTIVE = false;
let STATE_TRYON_DRAG_START_X = 0;
let STATE_TRYON_DRAG_START_Y = 0;

function saveTryOnApiKey(input) {
    const key = input.value.trim();
    if (key) {
        localStorage.setItem("mrt_gemini_api_key", key);
    } else {
        localStorage.removeItem("mrt_gemini_api_key");
    }
}


function openTryOnModal() {
    const prod = STATE.selectedProduct;
    if (!prod) return;
    
    const jewelImg = document.getElementById("tryon-jewel-img");
    const jewelTitle = document.getElementById("tryon-jewel-title");
    const jewelCat = document.getElementById("tryon-jewel-cat");
    
    if (jewelImg) jewelImg.src = prod.image;
    if (jewelTitle) jewelTitle.textContent = prod.title;
    if (jewelCat) jewelCat.textContent = prod.category;
    
    const apiKeyInp = document.getElementById("tryon-api-key");
    if (apiKeyInp) {
        apiKeyInp.value = localStorage.getItem("mrt_gemini_api_key") || atob("QVEuQWI4Uk42SVB5Z3lmRFFXZU5qcl90SUdKTDBENFJoRU9FaHlkM3F1Ym1hemdybEYzSkE=");
    }
    
    const fileInp = document.getElementById("tryon-file-input");
    if (fileInp) fileInp.value = "";
    STATE_TRYON_BASE64 = "";
    STATE_TRYON_RESULT_URL = "";
    
    const promptZone = document.getElementById("tryon-upload-prompt");
    const previewWrap = document.getElementById("tryon-upload-preview-wrap");
    const previewImg = document.getElementById("tryon-upload-preview");
    
    if (promptZone) promptZone.style.display = "block";
    if (previewWrap) previewWrap.style.display = "none";
    if (previewImg) previewImg.src = "";
    
    const displayPlaceholder = document.getElementById("tryon-placeholder-content");
    const aiResultWrap = document.getElementById("tryon-result-wrap");
    const btnSubmitAi = document.getElementById("tryon-submit-btn");
    const apiKeyGroup = document.getElementById("tryon-api-key-group");

    if (displayPlaceholder) displayPlaceholder.style.display = "block";
    if (aiResultWrap) aiResultWrap.style.display = "none";
    if (btnSubmitAi) btnSubmitAi.style.display = "none";
    if (apiKeyGroup) apiKeyGroup.style.display = "none";
    
    document.getElementById("tryon-modal").style.display = "block";
    document.getElementById("tryon-modal-overlay").style.display = "block";
}

function closeTryOnModal() {
    document.getElementById("tryon-modal").style.display = "none";
    document.getElementById("tryon-modal-overlay").style.display = "none";
}

function handleTryOnUpload(input) {
    const file = input.files[0];
    if (!file) return;
    
    if (file.size > 5 * 1024 * 1024) {
        alert("File size exceeds 5MB limit. Please upload a smaller image.");
        input.value = "";
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        STATE_TRYON_BASE64 = e.target.result;
        
        const promptZone = document.getElementById("tryon-upload-prompt");
        const previewWrap = document.getElementById("tryon-upload-preview-wrap");
        const previewImg = document.getElementById("tryon-upload-preview");
        
        if (promptZone) promptZone.style.display = "none";
        if (previewWrap) previewWrap.style.display = "block";
        if (previewImg) previewImg.src = e.target.result;
        
        const btnSubmitAi = document.getElementById("tryon-submit-btn");
        const apiKeyGroup = document.getElementById("tryon-api-key-group");
        
        if (btnSubmitAi) btnSubmitAi.style.display = "block";
        if (apiKeyGroup) apiKeyGroup.style.display = "block";
    };
    reader.readAsDataURL(file);
}

function clearTryOnUpload(event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const fileInp = document.getElementById("tryon-file-input");
    if (fileInp) fileInp.value = "";
    STATE_TRYON_BASE64 = "";
    STATE_TRYON_RESULT_URL = "";
    
    const promptZone = document.getElementById("tryon-upload-prompt");
    const previewWrap = document.getElementById("tryon-upload-preview-wrap");
    const previewImg = document.getElementById("tryon-upload-preview");
    
    if (promptZone) promptZone.style.display = "block";
    if (previewWrap) previewWrap.style.display = "none";
    if (previewImg) previewImg.src = "";
    const displayPlaceholder = document.getElementById("tryon-placeholder-content");
    const aiResultWrap = document.getElementById("tryon-result-wrap");
    const btnSubmitAi = document.getElementById("tryon-submit-btn");
    const apiKeyGroup = document.getElementById("tryon-api-key-group");

    if (displayPlaceholder) displayPlaceholder.style.display = "block";
    if (aiResultWrap) aiResultWrap.style.display = "none";
    if (btnSubmitAi) btnSubmitAi.style.display = "none";
    if (apiKeyGroup) apiKeyGroup.style.display = "none";
}

async function generateAiTryOn() {
    if (!STATE_TRYON_BASE64) {
        alert("Please upload a photo first to visualize the try-on!");
        return;
    }
    
    const prod = STATE.selectedProduct;
    if (!prod) return;
    
    const apiKeyInp = document.getElementById("tryon-api-key");
    let apiKey = apiKeyInp ? apiKeyInp.value.trim() : "";
    
    if (!apiKey) {
        apiKey = atob("QVEuQWI4Uk42SVB5Z3lmRFFXZU5qcl90SUdKTDBENFJoRU9FaHlkM3F1Ym1hemdybEYzSkE=");
    }
    
    const loadingOverlay = document.getElementById("tryon-loading-overlay");
    const statusNode = document.getElementById("tryon-loading-status");
    const descNode = document.getElementById("tryon-loading-desc");
    
    if (loadingOverlay) loadingOverlay.style.display = "flex";
    
    const statuses = [
        { title: "Analyzing photo & composing try-on...", desc: "Gemini is describing facial features and synthesizing the jewelry..." },
        { title: "Generating final rendering...", desc: "Applying lighting, photorealism, and metal reflections..." }
    ];
    
    let statusIdx = 0;
    statusNode.textContent = statuses[0].title;
    descNode.textContent = statuses[0].desc;
    
    const interval = setInterval(() => {
        statusIdx++;
        if (statusIdx < statuses.length) {
            statusNode.textContent = statuses[statusIdx].title;
            descNode.textContent = statuses[statusIdx].desc;
        } else {
            clearInterval(interval);
        }
    }, 3000);
    
    try {
        const userBase64Data = STATE_TRYON_BASE64.split(",")[1];
        const userMimeType = STATE_TRYON_BASE64.split(";")[0].split(":")[1] || "image/jpeg";
        
        let sizeStr = STATE.selectedSize ? `, size ${STATE.selectedSize}` : "";
        
        // Single call to gemini-2.0-flash with responseModalities TEXT and IMAGE
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        {
                            inlineData: {
                                mimeType: userMimeType,
                                data: userBase64Data
                            }
                        },
                        {
                            text: `This is a photo of a person. Generate a new, high-quality, photorealistic image of this exact person wearing a beautiful 925 sterling silver jewelry piece called "${prod.title}" (which is a ${prod.category}${sizeStr}) positioned realistically on their body. The jewelry must look shiny, metallic, detailed, and perfectly blended into the person's photo.`
                        }
                    ]
                }],
                generationConfig: {
                    responseModalities: ["TEXT", "IMAGE"]
                }
            })
        });

        clearInterval(interval);

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData?.error?.message || `Gemini Try-On failed (HTTP ${response.status})`);
        }

        const data = await response.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        
        // Find the image part in the response
        let imagePart = parts.find(p => p.inlineData && p.inlineData.mimeType && p.inlineData.mimeType.startsWith("image/"));
        
        if (!imagePart) {
            // Check if there is any text warning/explanation
            const textPart = parts.find(p => p.text);
            const warningMsg = textPart ? textPart.text : "No image returned by Gemini model.";
            throw new Error(warningMsg);
        }

        const generatedImageB64 = imagePart.inlineData.data;
        const resultDataUrl = `data:${imagePart.inlineData.mimeType},${generatedImageB64}`;
        
        if (loadingOverlay) loadingOverlay.style.display = "none";
        
        const placeholder = document.getElementById("tryon-placeholder-content");
        const resultWrap = document.getElementById("tryon-result-wrap");
        const resultImg = document.getElementById("tryon-result-img");
        
        STATE_TRYON_RESULT_URL = resultDataUrl;
        
        if (placeholder) placeholder.style.display = "none";
        if (resultWrap) resultWrap.style.display = "flex";
        if (resultImg) resultImg.src = resultDataUrl;
        
    } catch (err) {
        clearInterval(interval);
        if (loadingOverlay) loadingOverlay.style.display = "none";
        console.error("AI Try-On error:", err);
        
        let msg = err.message || "";
        if (msg.includes("quota") || msg.includes("limit: 0") || msg.includes("billing") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("free_tier")) {
            alert("AI Try-On failed: Google AI Studio requires a paid plan (billing enabled) for image generation models. Please upgrade your API key to a pay-as-you-go tier in Google AI Studio or use a paid key.");
        } else {
            alert("AI Try-On failed: " + msg);
        }
    }
}

function downloadTryOnResult() {
    if (!STATE_TRYON_RESULT_URL) return;
    const link = document.createElement("a");
    link.href = STATE_TRYON_RESULT_URL;
    link.target = "_blank";
    link.download = `mrt_ai_tryon_${STATE.selectedProduct ? STATE.selectedProduct.id : 'jewel'}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function shareTryOnWhatsapp() {
    const prod = STATE.selectedProduct;
    if (!prod) return;
    const message = `Hello UVIRA JEWELS, I just tried on the *${prod.title}* virtually using your AI Try-On tool! I would love to consult with you about purchasing this piece. (Product ID: ${prod.id})`;
    const url = `https://api.whatsapp.com/send?phone=919825098250&text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
}


function downloadOrderInvoicePdf(orderId) {
    const o = STATE.orders.find(order => order.id === orderId);
    if (!o) return;
    
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
        alert("Pop-up blocker prevented opening the invoice. Please allow pop-ups for this site.");
        return;
    }
    
    // Calculate values
    const taxDetails = calculateOrderGstAndShipping(o);
    const subtotal = o.subtotal;
    const discount = o.discount || 0;
    const total = o.total;
    const shippingFee = taxDetails.shippingFee;
    const gstTotal = taxDetails.gstTotal;
    const cgst = taxDetails.cgst;
    const sgst = taxDetails.sgst;
    const taxableAmount = taxDetails.taxableAmount;
    const customerName = getCustomerName(o.customer);
    
    const itemsRows = o.items.map((item, idx) => {
        let displayTitle = item.title;
        const prod = STATE.products.find(p => p.id === item.id);
        if (prod && prod.category) {
            const catLower = prod.category.toLowerCase();
            const catSingular = catLower.endsWith('s') ? catLower.slice(0, -1) : catLower;
            if (!displayTitle.toLowerCase().includes(catSingular)) {
                const catName = catSingular.charAt(0).toUpperCase() + catSingular.slice(1);
                displayTitle += ` - ${catName}`;
            }
        }
        
        return `
            <tr>
                <td style="padding: 10px; border-bottom: 1px solid #E2E8F0; text-align: center;">${idx + 1}</td>
                <td style="padding: 10px; border-bottom: 1px solid #E2E8F0;">
                    <div style="font-weight: 600;">${displayTitle}</div>
                </td>
                <td style="padding: 10px; border-bottom: 1px solid #E2E8F0; text-align: right;">₹${item.price.toLocaleString("en-IN")}</td>
                <td style="padding: 10px; border-bottom: 1px solid #E2E8F0; text-align: center;">${item.qty}</td>
                <td style="padding: 10px; border-bottom: 1px solid #E2E8F0; text-align: right; font-weight: 600;">₹${(item.price * item.qty).toLocaleString("en-IN")}</td>
            </tr>
        `;
    }).join("");
    
    const invoiceHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Invoice - ${o.id}</title>
            <meta charset="utf-8">
            <style>
                body {
                    font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                    color: #1A202C;
                    margin: 0;
                    padding: 30px;
                    background-color: #FFFFFF;
                }
                .invoice-card {
                    max-width: 800px;
                    margin: 0 auto;
                    border: 1px solid #E2E8F0;
                    padding: 40px;
                    border-radius: 8px;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                }
                .invoice-header {
                    display: flex;
                    justify-content: space-between;
                    border-bottom: 2px solid #E2E8F0;
                    padding-bottom: 20px;
                    margin-bottom: 30px;
                }
                .brand-title {
                    font-family: 'Georgia', serif;
                    font-size: 1.8rem;
                    font-weight: 700;
                    color: #1A365D;
                    letter-spacing: 1px;
                }
                .brand-sub {
                    font-size: 0.8rem;
                    color: #718096;
                    text-transform: uppercase;
                    letter-spacing: 2px;
                    margin-top: 4px;
                }
                .invoice-details {
                    text-align: right;
                }
                .invoice-title {
                    font-size: 1.5rem;
                    font-weight: 700;
                    color: #2D3748;
                    margin-bottom: 8px;
                }
                .meta-row {
                    font-size: 0.85rem;
                    color: #4A5568;
                    margin-bottom: 4px;
                }
                .meta-val {
                    font-weight: 600;
                }
                .billing-section {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 30px;
                    gap: 40px;
                }
                .billing-box {
                    flex: 1;
                    background-color: #F7FAFC;
                    padding: 15px 20px;
                    border-radius: 6px;
                    border-left: 4px solid #1A365D;
                }
                .box-title {
                    font-size: 0.75rem;
                    text-transform: uppercase;
                    color: #718096;
                    font-weight: 700;
                    letter-spacing: 1px;
                    margin-bottom: 8px;
                }
                .box-content {
                    font-size: 0.9rem;
                    line-height: 1.5;
                }
                .table-invoice {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 30px;
                }
                .table-invoice th {
                    background-color: #1A365D;
                    color: #FFFFFF;
                    padding: 12px 10px;
                    font-size: 0.85rem;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    font-weight: 600;
                }
                .totals-section {
                    display: flex;
                    justify-content: flex-end;
                }
                .totals-table {
                    width: 300px;
                    border-collapse: collapse;
                }
                .totals-table td {
                    padding: 8px 10px;
                    font-size: 0.9rem;
                }
                .totals-row-label {
                    color: #4A5568;
                }
                .totals-row-val {
                    text-align: right;
                    font-weight: 600;
                }
                .totals-grand {
                    border-top: 2px solid #E2E8F0;
                    border-bottom: 2px solid #E2E8F0;
                    font-size: 1.1rem !important;
                    font-weight: 700 !important;
                    color: #1A365D;
                }
                .footer-note {
                    margin-top: 50px;
                    text-align: center;
                    font-size: 0.8rem;
                    color: #A0AEC0;
                    border-top: 1px solid #E2E8F0;
                    padding-top: 15px;
                }
                @media print {
                    body {
                        padding: 0;
                        color: #000000;
                    }
                    .invoice-card {
                        border: none;
                        box-shadow: none;
                        padding: 0;
                        max-width: 100%;
                    }
                    .billing-box {
                        background-color: transparent !important;
                        border-left: 2px solid #000000;
                        padding: 10px;
                    }
                    .table-invoice th {
                        background-color: #E2E8F0 !important;
                        color: #000000 !important;
                        border-bottom: 2px solid #000000;
                    }
                    .footer-note {
                        page-break-inside: avoid;
                    }
                }
            </style>
        </head>
        <body>
            <div class="invoice-card">
                <div class="invoice-header">
                    <div>
                        <div class="brand-title">M. R. THANGA MAALIGAI</div>
                        <div class="brand-sub">Silver Jewellery</div>
                        <div style="font-size: 0.8rem; color: #4A5568; margin-top: 8px; line-height: 1.6;">
                            <strong>Legal Name:</strong> RAMCHAND SURESH KUMAR<br>
                            <strong>Trade Name:</strong> M. R. THANGA MAALIGAI<br>
                            <strong>GSTIN:</strong> 33AAKPS5130M1ZG<br>
                            12, Amin Marg, Rajkot - 360001<br>
                            Phone: +91 98250 98250
                        </div>
                    </div>
                    <div class="invoice-details">
                        <div class="invoice-title">TAX INVOICE</div>
                        <div class="meta-row">Invoice No: <span class="meta-val">${o.id}</span></div>
                        <div class="meta-row">Date: <span class="meta-val">${o.date}</span></div>
                        <div class="meta-row">Payment Mode: <span class="meta-val">${o.paymentMethod || o.payment_method || "COD"}</span></div>
                    </div>
                </div>
                
                <div class="billing-section">
                    <div class="billing-box">
                        <div class="box-title">Billed To (Customer)</div>
                        <div class="box-content">
                            <strong>${customerName}</strong><br>
                            Phone: ${o.phone}<br>
                            Address: ${o.address}
                        </div>
                    </div>
                    <div class="billing-box">
                        <div class="box-title">Seller Details</div>
                        <div class="box-content">
                            <strong>M. R. THANGA MAALIGAI</strong><br>
                            Legal Name: RAMCHAND SURESH KUMAR<br>
                            GSTIN: 33AAKPS5130M1ZG<br>
                            12, Amin Marg, Rajkot, Gujarat 360001<br>
                            Rajkot, Gujarat - 360001
                        </div>
                    </div>
                </div>
                
                <table class="table-invoice">
                    <thead>
                        <tr>
                            <th style="width: 8%; text-align: center;">S.No</th>
                            <th style="text-align: left;">Item Description</th>
                            <th style="width: 20%; text-align: right;">Unit Price</th>
                            <th style="width: 12%; text-align: center;">Qty</th>
                            <th style="width: 20%; text-align: right;">Total Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsRows}
                    </tbody>
                </table>
                
                <div class="totals-section">
                    <table class="totals-table">
                        <tr>
                            <td class="totals-row-label">Subtotal:</td>
                            <td class="totals-row-val">₹${subtotal.toLocaleString("en-IN")}</td>
                        </tr>
                        ${discount > 0 ? `
                        <tr>
                            <td class="totals-row-label">Discount:</td>
                            <td class="totals-row-val" style="color: #48BB78;">-₹${discount.toLocaleString("en-IN")}</td>
                        </tr>
                        ` : ''}
                        <tr>
                            <td class="totals-row-label">Taxable Amount:</td>
                            <td class="totals-row-val">₹${parseFloat(taxableAmount).toLocaleString("en-IN")}</td>
                        </tr>
                        <tr>
                            <td class="totals-row-label">Shipping:</td>
                            <td class="totals-row-val">₹${shippingFee}</td>
                        </tr>
                        <tr>
                            <td class="totals-row-label">CGST (1.5%):</td>
                            <td class="totals-row-val">₹${parseFloat(cgst).toLocaleString("en-IN")}</td>
                        </tr>
                        <tr>
                            <td class="totals-row-label">SGST (1.5%):</td>
                            <td class="totals-row-val">₹${parseFloat(sgst).toLocaleString("en-IN")}</td>
                        </tr>
                        <tr class="totals-grand">
                            <td>Grand Total:</td>
                            <td style="text-align: right;">₹${total.toLocaleString("en-IN")}</td>
                        </tr>
                    </table>
                </div>
                
                <div class="footer-note">
                    <p>Thank you for shopping at UVIRA JEWELS! All our jewelry is 92.5 Sterling Silver certified.</p>
                    <p style="font-size: 0.7rem; margin-top: 10px;">This is a computer-generated tax invoice and does not require a physical signature.</p>
                </div>
            </div>
            
            <script>
                window.onload = function() {
                    window.print();
                };
            </script>
        </body>
        </html>
    `;
    
    printWindow.document.open();
    printWindow.document.write(invoiceHtml);
    printWindow.document.close();
}

// --- RING SIZE GUIDE & HELPER FUNCTIONS ---
const INDIAN_RING_SIZES = [
    { size: "13", circumference: 53.0, diameter: 16.9 },
    { size: "14", circumference: 54.0, diameter: 17.2 },
    { size: "15", circumference: 55.0, diameter: 17.5 },
    { size: "16", circumference: 56.0, diameter: 17.8 },
    { size: "17", circumference: 57.2, diameter: 18.2 },
    { size: "18", circumference: 58.5, diameter: 18.6 },
    { size: "19", circumference: 59.7, diameter: 19.0 },
    { size: "20", circumference: 61.0, diameter: 19.4 },
    { size: "21", circumference: 62.2, diameter: 19.8 },
    { size: "22", circumference: 63.5, diameter: 20.2 },
    { size: "23", circumference: 64.7, diameter: 20.6 },
    { size: "24", circumference: 66.0, diameter: 21.0 },
    { size: "25", circumference: 67.2, diameter: 21.4 },
    { size: "26", circumference: 68.5, diameter: 21.8 },
    { size: "27", circumference: 69.7, diameter: 22.2 },
    { size: "28", circumference: 71.0, diameter: 22.6 }
];

let STATE_CALCULATED_SIZE = "";

function openSizeSelectorModal() {
    const overlay = document.getElementById("size-selector-overlay");
    const modal = document.getElementById("size-selector-modal");
    if (overlay) overlay.style.display = "block";
    if (modal) modal.style.display = "block";
}

function closeSizeSelectorModal() {
    const overlay = document.getElementById("size-selector-overlay");
    const modal = document.getElementById("size-selector-modal");
    if (overlay) overlay.style.display = "none";
    if (modal) modal.style.display = "none";
}

function openSizeGuideModal() {
    document.getElementById("size-guide-overlay").style.display = "block";
    document.getElementById("size-guide-modal").style.display = "block";
    
    // Reset Calculator state
    const circumInp = document.getElementById("ring-circum-input");
    if (circumInp) circumInp.value = "";
    const resBox = document.getElementById("size-calc-result-box");
    if (resBox) resBox.style.display = "none";
    STATE_CALCULATED_SIZE = "";
    
    // Populate Size Chart Tbody if empty
    const tbody = document.getElementById("size-guide-chart-tbody");
    if (tbody && !tbody.innerHTML.trim()) {
        tbody.innerHTML = INDIAN_RING_SIZES.map(s => `
            <tr>
                <td style="font-weight:700; text-align: center; padding: 8px;">Size ${s.size}</td>
                <td style="text-align: center; padding: 8px;">${s.circumference.toFixed(1)} mm</td>
                <td style="text-align: center; padding: 8px;">${s.diameter.toFixed(1)} mm</td>
            </tr>
        `).join("");
    }
    
    // Default to Calculator tab
    toggleSizeGuideTab('calc');
}

function closeSizeGuideModal() {
    document.getElementById("size-guide-overlay").style.display = "none";
    document.getElementById("size-guide-modal").style.display = "none";
}

function toggleSizeGuideTab(tab) {
    const tabCalc = document.getElementById("size-tab-calc");
    const tabChart = document.getElementById("size-tab-chart");
    const contentCalc = document.getElementById("size-content-calc");
    const contentChart = document.getElementById("size-content-chart");
    
    if (tab === 'calc') {
        if (tabCalc) {
            tabCalc.style.color = "var(--color-accent-pink)";
            tabCalc.style.borderBottom = "2px solid var(--color-accent-pink)";
        }
        if (tabChart) {
            tabChart.style.color = "var(--color-silver-dark)";
            tabChart.style.borderBottom = "2px solid transparent";
        }
        if (contentCalc) contentCalc.style.display = "block";
        if (contentChart) contentChart.style.display = "none";
    } else {
        if (tabCalc) {
            tabCalc.style.color = "var(--color-silver-dark)";
            tabCalc.style.borderBottom = "2px solid transparent";
        }
        if (tabChart) {
            tabChart.style.color = "var(--color-accent-pink)";
            tabChart.style.borderBottom = "2px solid var(--color-accent-pink)";
        }
        if (contentCalc) contentCalc.style.display = "none";
        if (contentChart) contentChart.style.display = "block";
    }
}

function calculateRingSizeFromInput() {
    const circumInp = document.getElementById("ring-circum-input");
    if (!circumInp) return;
    
    const value = parseFloat(circumInp.value);
    const resBox = document.getElementById("size-calc-result-box");
    
    if (isNaN(value) || value < 40 || value > 90) {
        if (resBox) resBox.style.display = "none";
        STATE_CALCULATED_SIZE = "";
        return;
    }
    
    // Find closest ring size
    let closest = INDIAN_RING_SIZES[0];
    let minDiff = Math.abs(closest.circumference - value);
    
    for (let i = 1; i < INDIAN_RING_SIZES.length; i++) {
        const diff = Math.abs(INDIAN_RING_SIZES[i].circumference - value);
        if (diff < minDiff) {
            minDiff = diff;
            closest = INDIAN_RING_SIZES[i];
        }
    }
    
    STATE_CALCULATED_SIZE = closest.size;
    
    const sizeValNode = document.getElementById("calculated-size-val");
    const sizeDescNode = document.getElementById("calculated-size-desc");
    
    if (sizeValNode) sizeValNode.textContent = closest.size;
    if (sizeDescNode) sizeDescNode.innerHTML = `Fits ~${closest.circumference.toFixed(1)} mm finger circumference (Diameter: ${closest.diameter.toFixed(1)} mm)`;
    
    if (resBox) resBox.style.display = "block";
}

function applyCalculatedRingSize() {
    if (!STATE_CALCULATED_SIZE) return;
    
    // Find the option circle element that matches the calculated size
    const optionsContainer = document.getElementById("detail-size-options");
    if (optionsContainer) {
        const circles = Array.from(optionsContainer.querySelectorAll(".size-option-circle"));
        const targetCircle = circles.find(el => el.textContent.trim() === STATE_CALCULATED_SIZE);
        if (targetCircle) {
            selectProductSize(STATE_CALCULATED_SIZE, targetCircle);
        }
    }
    
    closeSizeGuideModal();
}

function toggleShopFilters() {
    const filters = document.querySelector('.shop-sidebar-filters');
    if (filters) {
        filters.classList.toggle('filters-open');
    }
}

// QR Zoom Modal Functions
function openQrZoom() {
    const overlay = document.getElementById('qr-zoom-overlay');
    const modal = document.getElementById('qr-zoom-modal');
    const content = document.getElementById('qr-zoom-content');
    const container = document.getElementById('checkout-upi-qr-container');
    
    if (overlay && modal && content && container) {
        content.innerHTML = container.innerHTML; // Clone the image/svg
        // Increase size of cloned content
        const clonedImg = content.querySelector('img');
        const clonedSvg = content.querySelector('svg');
        if (clonedImg) {
            clonedImg.style.width = '100%';
            clonedImg.style.height = '100%';
            clonedImg.style.objectFit = 'contain';
        }
        if (clonedSvg) {
            clonedSvg.setAttribute('width', '100%');
            clonedSvg.setAttribute('height', '100%');
        }
        
        overlay.style.display = 'block';
        modal.style.display = 'block';
    }
}

function closeQrZoom() {
    const overlay = document.getElementById('qr-zoom-overlay');
    const modal = document.getElementById('qr-zoom-modal');
    if (overlay) overlay.style.display = 'none';
    if (modal) modal.style.display = 'none';
}

// --- AUTHENTICATION & USER PROFILES ---
let isAuthSignupMode = false;

function migrateTdsForUser(user) {
    if (!user || !user.referral_commissions) return false;
    
    const commissions = user.referral_commissions || [];
    const tdsRedemptions = user.tds_redemptions || [];
    
    const redeemedCommissions = commissions.filter(c => c.is_redeemed);
    if (redeemedCommissions.length === 0) return false;
    
    const totalRedeemedGross = redeemedCommissions.reduce((sum, c) => sum + c.commission_amount, 0);
    const totalTdsGross = tdsRedemptions.reduce((sum, r) => sum + (parseFloat(r.gross_amount) || 0), 0);
    
    const diff = totalRedeemedGross - totalTdsGross;
    if (diff > 0.01) {
        const legacyTds = parseFloat((diff * 0.10).toFixed(2));
        const legacyNet = parseFloat((diff * 0.90).toFixed(2));
        
        let latestRedeemedDate = new Date().toISOString();
        let hasValidDate = false;
        redeemedCommissions.forEach(c => {
            if (c.redeemed_date) {
                if (!hasValidDate || new Date(c.redeemed_date) > new Date(latestRedeemedDate)) {
                    latestRedeemedDate = c.redeemed_date;
                    hasValidDate = true;
                }
            }
        });
        
        if (!user.tds_redemptions) {
            user.tds_redemptions = [];
        }
        
        user.tds_redemptions.push({
            redemption_date: latestRedeemedDate,
            gross_amount: parseFloat(diff.toFixed(2)),
            tds_amount: legacyTds,
            net_amount: legacyNet,
            coupon_code: 'LEGACY-REF-MIGRATE'
        });
        return true;
    }
    return false;
}

function initAuthListener() {
    const savedToken = localStorage.getItem('mrt_user_token');
    const savedEmail = localStorage.getItem('mrt_user_email');
    if (savedToken && savedEmail) {
        fetchUserProfile(savedEmail, savedToken);
    } else {
        STATE.user = null;
        STATE.profile = null;
    }
}

async function fetchUserProfile(email, token) {
    const { data, error } = await supaClient.from('settings').select('value').eq('key', 'user_' + email).single();
    if (data && data.value) {
        try {
            const userData = JSON.parse(data.value);
            if (userData.token === token) {
                const didMigrate = migrateTdsForUser(userData);
                STATE.user = userData;
                STATE.profile = { digi_silver_balance: userData.digi_silver_balance || 0 };
                
                if (didMigrate) {
                    supaClient.from('settings').update({ value: JSON.stringify(userData) }).eq('key', 'user_' + email).then(({error}) => {
                        if (error) console.error("Error saving migrated user:", error);
                    });
                }
                
                updateProfileUI();
                return;
            }
        } catch(e) {}
    }
    // Fallback if mismatched or not found
    handleLogout();
}


function updateProfileUI() {
    const balEl = document.getElementById('profile-digi-balance');
    const lockedEl = document.getElementById('profile-locked-balance');
    const rateEl = document.getElementById('profile-silver-rate');
    const ordersList = document.getElementById('profile-orders-list');
    
    if (balEl && STATE.profile) {
        balEl.textContent = parseFloat(STATE.profile.digi_silver_balance).toFixed(2);
    }
    if (lockedEl) {
        lockedEl.textContent = "0.00";
    }
    if (rateEl && STATE.rates) {
        rateEl.textContent = `₹${STATE.rates.fine} / g`;
    }
    
    if (ordersList && STATE.user) {
        const savedPhone = localStorage.getItem("mrt_checkout_phone");
        const userOrders = STATE.orders.filter(o => {
            if (o.id && String(o.id).startsWith("UVR-RDM")) return false; // Hide coupon redemptions
            const custStr = typeof o.customer === 'string' ? o.customer : JSON.stringify(o.customer || {});
            
            // 1. Strict Email Match (most reliable)
            if (STATE.user && STATE.user.email && custStr.toLowerCase().includes(STATE.user.email.toLowerCase())) return true;
            
            // 2. Strict Token Match
            if (STATE.user && STATE.user.token && custStr.includes(STATE.user.token)) return true;
            
            // 3. Fallback for older orders placed before email linking
            if (savedPhone && o.phone && o.phone.replace(/[^0-9]/g, '') === savedPhone.replace(/[^0-9]/g, '')) return true;
            
            return false;
        });
        
        // Calculate locked balance (awaiting_approval or processing orders with Digi Silver)
        let lockedGrams = 0;
        userOrders.forEach(o => {
            const isPending = o.status === 'awaiting_approval' || o.status === 'processing';
            if (isPending) {
                const itemsArr = Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? safeJSONParse(o.items, []) : []);
                itemsArr.forEach(item => {
                    const isDigi = item.isDigiSilver || (item.title && item.title.toLowerCase().includes('digi silver'));
                    if (isDigi && item.grams) {
                        lockedGrams += parseFloat(item.grams);
                    }
                });
            }
        });
        if (lockedEl) {
            lockedEl.textContent = lockedGrams.toFixed(2);
        }
        
        if (userOrders.length === 0) {
            ordersList.innerHTML = '<p style="color: var(--color-silver-dark);">You have no orders yet.</p>';
        } else {
            ordersList.innerHTML = userOrders.map(o => {
                const itemsArr = Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? safeJSONParse(o.items, []) : []);
                const itemsList = itemsArr.map(item => `
                    <div style="font-size: 0.85rem; color: var(--color-silver-dark); margin-top: 4px; display: flex; justify-content: space-between;">
                        <span>• ${item.title} (x${item.qty})</span>
                        <span>₹${(item.price * item.qty).toLocaleString("en-IN")}</span>
                    </div>
                `).join('');
                
                return `
                <div style="background: #fff; padding: 20px; border-radius: var(--border-radius-sm); border: 1px solid var(--color-silver-mid); display: flex; flex-direction: column; gap: 15px; margin-bottom: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.02);">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #f1f1f1; padding-bottom: 12px;">
                        <div>
                            <div style="font-weight: 800; font-family: var(--font-heading); font-size: 1.1rem; color: var(--color-primary); margin-bottom: 5px;">Order #${o.id}</div>
                            <div style="font-size: 0.85rem; color: var(--color-silver-dark);">${o.date}</div>
                        </div>
                        <div style="background-color: var(--color-primary); color: white; padding: 6px 12px; border-radius: 4px; font-size: 0.8rem; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">
                            ${o.status || 'Pending'}
                        </div>
                    </div>
                    
                    <div>
                        <div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 8px;">Items Ordered:</div>
                        ${itemsList}
                    </div>
                    
                    <div style="border-top: 1px solid #f1f1f1; padding-top: 12px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.85rem; color: var(--color-silver-dark);">Payment: ${o.paymentMethod || o.payment_method || 'COD'}</span>
                        <div style="font-weight: 700; color: var(--color-accent-pink); font-size: 1.1rem;">Total: ₹${o.total.toLocaleString("en-IN")}</div>
                    </div>
                </div>
                `;
            }).join('');
        }
    }
    
    // Load User Coupons
    const couponsList = document.getElementById('profile-coupons-list');
    if (couponsList && STATE.user && STATE.user.email) {
        supaClient.from('coupons').select('*').eq('owner_email', STATE.user.email).then(({ data, error }) => {
            if (error || !data || data.length === 0) {
                couponsList.innerHTML = '<div style="color: var(--color-silver-dark); font-size: 0.9rem;">No coupons found. Convert Digi Silver to get discount codes!</div>';
            } else {
                couponsList.innerHTML = data.map(c => `
                <div style="background: #fff; padding: 15px; border-radius: var(--border-radius-sm); border: 1px solid var(--color-silver-mid); display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <div>
                        <div style="font-weight: 800; font-family: var(--font-heading); font-size: 1.1rem; color: var(--color-primary); margin-bottom: 5px;">${c.code}</div>
                        <div style="font-size: 0.85rem; color: var(--color-silver-dark);">${c.type === 'percentage' ? c.value + '% OFF' : '₹' + c.value + ' OFF'}</div>
                    </div>
                    <div style="background-color: ${c.is_used ? '#EF4444' : '#10B981'}; color: white; padding: 6px 12px; border-radius: 4px; font-size: 0.8rem; text-transform: uppercase; font-weight: 700;">
                        ${c.is_used ? 'Used' : 'Available'}
                    </div>
                </div>`).join('');
            }
        });
    }
    
    // Refer & Earn UI Rendering
    if (STATE.user) {
        const refCodeEl = document.getElementById('profile-referral-code');
        if (refCodeEl) refCodeEl.textContent = STATE.user.referral_code || 'N/A';
        
        // Fetch referred friends list and count
        if (STATE.user.referral_code) {
            supaClient.from('settings').select('*').like('key', 'user_%').then(({ data }) => {
                const users = data ? data.filter(s => s.key.startsWith('user_')).map(s => {
                    try { return JSON.parse(s.value); } catch(e) { return null; }
                }).filter(Boolean) : [];
                
                const referredFriends = users.filter(u => u.referred_by === STATE.user.referral_code);
                
                const refCountEl = document.getElementById('referral-stat-count');
                if (refCountEl) refCountEl.textContent = referredFriends.length;
                
                const refListEl = document.getElementById('profile-referrals-list');
                if (refListEl) {
                    if (referredFriends.length === 0) {
                        refListEl.innerHTML = '<div style="color: var(--color-silver-dark); font-size: 0.85rem; padding: 10px 0;">No friends referred yet.</div>';
                    } else {
                        refListEl.innerHTML = referredFriends.map(f => `
                            <div style="font-size: 0.85rem; padding: 8px; border-bottom: 1px solid #f1f1f1; display: flex; justify-content: space-between; align-items: center; background: #fafafa; border-radius: 4px; margin-bottom: 4px;">
                                <span style="font-weight: 700; color: var(--color-primary);">${f.name || f.email.split('@')[0]}</span>
                                <span style="color: var(--color-silver-dark); font-size: 0.75rem;">${f.email}</span>
                            </div>
                        `).join('');
                    }
                }
            }).catch(e => console.error("Error fetching referred friends:", e));
        }
        
        // Calculate and render commissions stats
        const commissions = STATE.user.referral_commissions || [];
        let totalEarned = 0;
        let pendingEarned = 0;
        let redeemableEarned = 0;
        const now = new Date();
        
        commissions.forEach(c => {
            const orderDate = new Date(c.order_date);
            const hoursPassed = (now - orderDate) / (1000 * 60 * 60);
            totalEarned += c.commission_amount;
            if (!c.is_redeemed) {
                if (hoursPassed < 24) {
                    pendingEarned += c.commission_amount;
                } else {
                    redeemableEarned += c.commission_amount;
                }
            }
        });
        
        const totalEl = document.getElementById('referral-stat-total');
        if (totalEl) totalEl.textContent = `₹${totalEarned.toFixed(2)}`;
        
        const pendingEl = document.getElementById('referral-stat-pending');
        if (pendingEl) pendingEl.textContent = `₹${pendingEarned.toFixed(2)}`;
        
        const redeemableEl = document.getElementById('referral-stat-redeemable');
        if (redeemableEl) redeemableEl.textContent = `₹${redeemableEarned.toFixed(2)}`;
        
        const tdsRedemptions = STATE.user.tds_redemptions || [];
        const totalTdsDeducted = tdsRedemptions.reduce((sum, r) => sum + (parseFloat(r.tds_amount) || 0), 0);
        const totalNetRedeemed = tdsRedemptions.reduce((sum, r) => sum + (parseFloat(r.net_amount) || 0), 0);
        
        const tdsEl = document.getElementById('referral-stat-tds');
        if (tdsEl) tdsEl.textContent = `₹${totalTdsDeducted.toFixed(2)}`;
        
        const netEl = document.getElementById('referral-stat-net');
        if (netEl) netEl.textContent = `₹${totalNetRedeemed.toFixed(2)}`;
        
        const redeemBtn = document.getElementById('referral-redeem-btn');
        if (redeemBtn) {
            if (redeemableEarned > 0) {
                redeemBtn.disabled = false;
                redeemBtn.style.opacity = '1';
                redeemBtn.style.cursor = 'pointer';
                redeemBtn.textContent = `Redeem Matured Commissions (₹${redeemableEarned.toFixed(2)}) to Coupon`;
            } else {
                redeemBtn.disabled = true;
                redeemBtn.style.opacity = '0.5';
                redeemBtn.style.cursor = 'not-allowed';
                redeemBtn.textContent = `Redeem Matured Commissions to Coupon`;
            }
        }
        
        const commListEl = document.getElementById('profile-commissions-list');
        if (commListEl) {
            if (commissions.length === 0) {
                commListEl.innerHTML = '<div style="color: var(--color-silver-dark); font-size: 0.85rem; padding: 10px 0;">No commission history yet.</div>';
            } else {
                commListEl.innerHTML = commissions.map(c => {
                    const orderDate = new Date(c.order_date);
                    const hoursPassed = (now - orderDate) / (1000 * 60 * 60);
                    let statusStr = "Redeemed";
                    let statusColor = "#10B981";
                    if (!c.is_redeemed) {
                        if (hoursPassed < 24) {
                            const hoursLeft = Math.ceil(24 - hoursPassed);
                            statusStr = `Pending (${hoursLeft}h left)`;
                            statusColor = "#D97706";
                        } else {
                            statusStr = "Ready";
                            statusColor = "#2563EB";
                        }
                    }
                    return `
                        <div style="font-size: 0.82rem; padding: 8px; border-bottom: 1px solid #f1f1f1; display: flex; flex-direction: column; gap: 4px; background: #fafafa; border-radius: 4px; margin-bottom: 4px;">
                            <div style="display: flex; justify-content: space-between; font-weight: 700;">
                                <span style="color: var(--color-primary);">Order #${c.order_id}</span>
                                <span style="color: #10B981;">+₹${c.commission_amount.toFixed(2)}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--color-silver-dark);">
                                <span>From ${c.buyer_name} (${new Date(c.order_date).toLocaleDateString()})</span>
                                <span style="color: ${statusColor}; font-weight: 800; text-transform: uppercase;">${statusStr}</span>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }
    }
}

function copyReferralCode() {
    if (STATE.user && STATE.user.referral_code) {
        navigator.clipboard.writeText(STATE.user.referral_code).then(() => {
            alert("Referral Code copied to clipboard: " + STATE.user.referral_code);
        }).catch(e => {
            console.error(e);
            alert("Referral Code: " + STATE.user.referral_code);
        });
    }
}

function copyReferralLink() {
    if (STATE.user && STATE.user.referral_code) {
        const origin = window.location.origin;
        const link = `${origin}/?ref=${STATE.user.referral_code}`;
        navigator.clipboard.writeText(link).then(() => {
            alert("Referral Link copied: " + link);
        }).catch(e => {
            console.error(e);
            alert("Link: " + link);
        });
    }
}

async function redeemReferralCommissions() {
    if (!STATE.user) return;
    if (!STATE.user.pan) {
        openPanModal(redeemReferralCommissions);
        return;
    }
    if (STATE.user.pan_status === 'pending_approval') {
        alert("Your PAN verification is currently pending admin approval. You can redeem commissions once approved.");
        return;
    }
    if (STATE.user.pan_status !== 'approved') {
        alert("Your PAN verification status is invalid. Please contact support.");
        return;
    }
    const commissions = STATE.user.referral_commissions || [];
    const now = new Date();
    
    const maturedToRedeem = commissions.filter(c => {
        const orderDate = new Date(c.order_date);
        const hoursPassed = (now - orderDate) / (1000 * 60 * 60);
        return !c.is_redeemed && hoursPassed >= 24;
    });
    
    const redeemableAmount = maturedToRedeem.reduce((sum, c) => sum + c.commission_amount, 0);
    if (redeemableAmount <= 0) {
        return alert("You have no matured commissions ready to redeem yet. Please wait 24 hours after your referrals' purchase approval.");
    }
    
    const tdsAmount = parseFloat((redeemableAmount * 0.10).toFixed(2));
    const netAmount = parseFloat((redeemableAmount * 0.90).toFixed(2));
    
    if (confirm(`Are you sure you want to redeem ₹${redeemableAmount.toFixed(2)} worth of commissions?\n\n- 10% TDS Deducted: ₹${tdsAmount.toFixed(2)}\n- Net Voucher Coupon Generated: ₹${netAmount.toFixed(2)}`)) {
        try {
            const code = 'UVR-REF-' + Math.random().toString(36).substr(2, 6).toUpperCase();
            
            await supaClient.from('coupons').insert([{
                code: code,
                discount: 0,
                type: 'amount',
                value: netAmount,
                is_used: false,
                single_use: true,
                owner_email: STATE.user.email
            }]);
            
            maturedToRedeem.forEach(c => {
                c.is_redeemed = true;
                c.redeemed_date = now.toISOString();
            });
            
            if (!STATE.user.tds_redemptions) {
                STATE.user.tds_redemptions = [];
            }
            STATE.user.tds_redemptions.push({
                redemption_date: now.toISOString(),
                gross_amount: parseFloat(redeemableAmount.toFixed(2)),
                tds_amount: tdsAmount,
                net_amount: netAmount,
                coupon_code: code
            });
            
            await supaClient.from('settings').update({ value: JSON.stringify(STATE.user) }).eq('key', 'user_' + STATE.user.email);
            
            alert(`🎉 Success! Your referral commission has been redeemed.\n- Gross Amount: ₹${redeemableAmount.toFixed(2)}\n- 10% TDS Deducted: ₹${tdsAmount.toFixed(2)}\n- Coupon Code Created: ${code} (Value: ₹${netAmount.toFixed(2)}).\nUse this coupon code at checkout for your discount!`);
            updateProfileUI();
        } catch(e) {
            console.error(e);
            alert("Failed to redeem commissions. Please try again.");
        }
    }
}

function openAuthModal() {
    document.getElementById('auth-overlay').style.display = 'block';
    document.getElementById('auth-modal').style.display = 'block';
}

function openUserProfile() {
    if (STATE.user) {
        navigateTo('profile');
        updateProfileUI();
    } else {
        openAuthModal();
    }
}

function closeAuthModal() {
    document.getElementById('auth-overlay').style.display = 'none';
    document.getElementById('auth-modal').style.display = 'none';
}

function toggleAuthMode() {
    isAuthSignupMode = !isAuthSignupMode;
    document.getElementById('auth-title').textContent = isAuthSignupMode ? 'Sign Up' : 'Login to UVIRA JEWELS';
    document.getElementById('auth-submit-btn').textContent = isAuthSignupMode ? 'Create Account' : 'Login';
    document.getElementById('auth-toggle-text').textContent = isAuthSignupMode ? 'Already have an account?' : "Don't have an account?";
    document.getElementById('auth-toggle-link').textContent = isAuthSignupMode ? 'Login' : 'Sign up';
    document.getElementById('auth-error').style.display = 'none';
    const refGroup = document.getElementById('auth-referral-group');
    if (refGroup) refGroup.style.display = isAuthSignupMode ? 'block' : 'none';
}

async function handleAuthSubmit() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const errEl = document.getElementById('auth-error');
    errEl.style.display = 'none';

    if (!email || !password) {
        errEl.textContent = "Please enter email and password.";
        errEl.style.display = 'block';
        return;
    }

    document.getElementById('auth-submit-btn').textContent = "Please wait...";

    try {
        if (isAuthSignupMode) {
            const { data: exist } = await supaClient.from('settings').select('key').eq('key', 'user_' + email).single();
            if (exist) throw new Error("Email already registered. Please login.");
            
            let referredByVal = null;
            const refInp = document.getElementById('auth-referral-code');
            const refCodeEntered = refInp ? refInp.value.trim().toUpperCase() : "";
            if (refCodeEntered) {
                const { data: allSettings } = await supaClient.from('settings').select('*').like('key', 'user_%');
                const users = allSettings ? allSettings.filter(s => s.key.startsWith('user_')).map(s => {
                    try { return JSON.parse(s.value); } catch(e) { return null; }
                }).filter(Boolean) : [];
                
                const referrer = users.find(u => u.referral_code === refCodeEntered);
                if (!referrer) {
                    throw new Error("Invalid Referral Code! Please check or leave empty.");
                }
                if (referrer.email === email) {
                    throw new Error("You cannot refer yourself.");
                }
                referredByVal = refCodeEntered;
            }
            
            const token = 'UVR-USER-' + Math.random().toString(36).substr(2, 9);
            const referralCode = 'REF' + Math.random().toString(36).substr(2, 6).toUpperCase();
            
            const newUser = { 
                token, 
                email, 
                password, 
                name: email.split('@')[0], 
                digi_silver_balance: 0,
                referral_code: referralCode,
                referred_by: referredByVal,
                referral_commissions: []
            };
            
            await supaClient.from('settings').insert([{ key: 'user_' + email, value: JSON.stringify(newUser) }]);
            
            alert(`Signup successful! Your referral code is ${referralCode}. Please login.`);
            if (refInp) refInp.value = "";
            toggleAuthMode();
        } else {
            const { data, error } = await supaClient.from('settings').select('value').eq('key', 'user_' + email).single();
            if (error || !data) throw new Error("Email not registered. Please sign up.");
            
            const userRecord = JSON.parse(data.value);
            if (userRecord.password !== password) throw new Error("Invalid login credentials.");
            
            const didMigrate = migrateTdsForUser(userRecord);
            if (didMigrate) {
                await supaClient.from('settings').update({ value: JSON.stringify(userRecord) }).eq('key', 'user_' + email);
            }
            
            localStorage.setItem('mrt_user_token', userRecord.token);
            localStorage.setItem('mrt_user_email', userRecord.email);
            
            STATE.user = userRecord;
            STATE.profile = { digi_silver_balance: userRecord.digi_silver_balance || 0 };
            
            closeAuthModal();
            openUserProfile();
            updateProfileUI();
        }
    } catch (err) {
        errEl.textContent = err.message || "Authentication failed.";
        errEl.style.display = 'block';
    } finally {
        document.getElementById('auth-submit-btn').textContent = isAuthSignupMode ? 'Create Account' : 'Login';
    }
}

async function handleLogout() {
    localStorage.removeItem('mrt_user_token');
    localStorage.removeItem('mrt_user_email');
    STATE.user = null;
    STATE.profile = null;
    navigateTo('home');
}

// --- DIGI SILVER ---
function buyDigiSilver() {
    if (!STATE.user) {
        alert("Please login or sign up to buy Digi Silver.");
        openAuthModal();
        return;
    }
    if (!STATE.user.aadhar) {
        openAadharModal(buyDigiSilver);
        return;
    }
    if (STATE.user.aadhar_status === 'pending_approval') {
        alert("Your Aadhar verification is currently pending admin approval. You can perform transactions once approved.");
        return;
    }
    if (STATE.user.aadhar_status !== 'approved') {
        alert("Your Aadhar verification status is invalid. Please contact support.");
        return;
    }

    const amountStr = document.getElementById('buy-digi-amount').value;
    const amount = parseFloat(amountStr);
    if (!amount || amount < 100) return alert("Minimum investment is ₹100.");
    
    const grams = parseFloat((amount / STATE.rates.fine).toFixed(4));
    
    const digiItem = {
        id: "DIGI-SILVER-BUY-" + Date.now(),
        title: `Digi Silver (${grams}g)`,
        price: amount,
        image: "https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&fit=crop&w=300&q=80",
        qty: 1,
        isDigiSilver: true,
        grams: grams
    };
    
    // Check if there is already a Digi Silver item to merge
    const existingIndex = STATE.cart.findIndex(i => i.isDigiSilver);
    if (existingIndex > -1) {
        STATE.cart[existingIndex].price += amount;
        STATE.cart[existingIndex].grams = parseFloat((STATE.cart[existingIndex].grams + grams).toFixed(4));
        STATE.cart[existingIndex].title = `Digi Silver (${STATE.cart[existingIndex].grams}g)`;
    } else {
        STATE.cart.push(digiItem);
    }
    
    saveCart();
    checkoutCart();
}

function redeemDigiSilver() {
    if (!STATE.user) {
        alert("Please login or sign up to redeem Digi Silver.");
        openAuthModal();
        return;
    }
    if (!STATE.user.aadhar) {
        openAadharModal(redeemDigiSilver);
        return;
    }
    if (STATE.user.aadhar_status === 'pending_approval') {
        alert("Your Aadhar verification is currently pending admin approval. You can perform transactions once approved.");
        return;
    }
    if (STATE.user.aadhar_status !== 'approved') {
        alert("Your Aadhar verification status is invalid. Please contact support.");
        return;
    }

    const gramsStr = document.getElementById('redeem-digi-grams').value;
    const grams = parseFloat(gramsStr);
    
    if (!STATE.profile || grams > STATE.profile.digi_silver_balance) {
        return alert("Insufficient Digi Silver balance.");
    }
    if (!grams || grams <= 0) return alert("Enter valid grams.");

    const value = Math.round(grams * STATE.rates.fine * 1.03);
    
    // Simulate redeeming logic
    // Generate a unique local coupon and apply it to cart.
    const code = `DIGI-${Math.floor(Math.random() * 10000)}`;
    
    STATE.coupons[code] = {
        code: code,
        type: "fixed",
        value: value,
        is_used: false,
        single_use: true
    };
    
    // Save coupon to Supabase
    const ownerEmail = (STATE.user && STATE.user.email) ? STATE.user.email : null;
    supaClient.from('coupons').insert([{ 
        code: code, 
        discount: 0,
        type: "fixed",
        value: value,
        is_used: false,
        single_use: true,
        owner_email: ownerEmail
    }]).then(res => {
        if(res.error) console.error("Error saving digi silver coupon:", res.error);
    });

    alert(`Successfully redeemed ${grams}g!\nYour discount code is: ${code} (Value: ₹${value})\nYou can apply this at checkout.`);
    
    // Apply deductive balance and sync to Custom DB
    STATE.profile.digi_silver_balance -= grams;
    
    // Save to user if logged in
    if (STATE.user && STATE.user.email) {
        STATE.user.digi_silver_balance = STATE.profile.digi_silver_balance;
        supaClient.from('settings').update({ value: JSON.stringify(STATE.user) }).eq('key', 'user_' + STATE.user.email).then().catch(e=>console.error(e));
    }
    
    // Save redemption to Order History
    const rdmOrderId = `UVR-RDM-${Math.floor(Math.random() * 10000)}`;
    const newOrder = {
        id: `UVR-RDM-${Math.floor(1000 + Math.random() * 9000)}`,
        date: new Date().toISOString().split("T")[0],
        customer: JSON.stringify({ name: STATE.user.name || "Digi Buyer", email: STATE.user.email, token: STATE.user.token }),
        phone: "",
        address: "Digi Silver Wallet Redemption",
        paymentMethod: "Redeemed",
        subtotal: value,
        discount: value,
        total: 0,
        status: "approved",
        items: JSON.stringify([{
            title: `Redeemed ${grams}g Digi Silver (Code: ${code})`,
            price: value,
            qty: 1,
            isDigiSilver: false
        }])
    };
    
    STATE.orders.push(newOrder);
    supaClient.from('orders').insert({
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
    }).then().catch(e=>console.error(e));
    
    updateProfileUI();
}

function sellDigiSilver() {
    if (!STATE.user) {
        alert("Please login or sign up to cash out Digi Silver.");
        openAuthModal();
        return;
    }
    if (!STATE.user.aadhar) {
        openAadharModal(sellDigiSilver);
        return;
    }
    if (STATE.user.aadhar_status === 'pending_approval') {
        alert("Your Aadhar verification is currently pending admin approval. You can perform transactions once approved.");
        return;
    }
    if (STATE.user.aadhar_status !== 'approved') {
        alert("Your Aadhar verification status is invalid. Please contact support.");
        return;
    }

    const amountStr = document.getElementById('sell-digi-amount').value;
    const amount = parseFloat(amountStr);
    
    if (!amount || amount <= 0) return alert("Enter a valid amount to cash out.");
    
    const grams = parseFloat((amount / STATE.rates.fine).toFixed(4));
    
    if (!STATE.profile || grams > STATE.profile.digi_silver_balance) {
        return alert(`Insufficient Digi Silver balance. You need at least ${grams}g to cash out ₹${amount}.`);
    }

    STATE.pendingCashOut = { amount, grams };
    openCashOutModal();
}

function openCashOutModal() {
    const overlay = document.getElementById('cashout-modal-overlay');
    const modal = document.getElementById('cashout-modal');
    if (overlay) overlay.style.display = 'block';
    if (modal) modal.style.display = 'block';
    
    // Reset input fields
    const upiId = document.getElementById('payout-upi-id');
    const holder = document.getElementById('payout-bank-holder');
    const num = document.getElementById('payout-bank-number');
    const ifsc = document.getElementById('payout-bank-ifsc');
    if (upiId) upiId.value = "";
    if (holder) holder.value = "";
    if (num) num.value = "";
    ifsc.value = "";
}

function closeCashOutModal() {
    const overlay = document.getElementById('cashout-modal-overlay');
    const modal = document.getElementById('cashout-modal');
    if (overlay) overlay.style.display = 'none';
    if (modal) modal.style.display = 'none';
    STATE.pendingCashOut = null;
}

function togglePayoutFields() {
    const method = document.querySelector('input[name="payout-method"]:checked').value;
    const upiFields = document.getElementById('payout-upi-fields');
    const bankFields = document.getElementById('payout-bank-fields');
    if (method === 'UPI') {
        if (upiFields) upiFields.style.display = 'block';
        if (bankFields) bankFields.style.display = 'none';
    } else {
        if (upiFields) upiFields.style.display = 'none';
        if (bankFields) bankFields.style.display = 'block';
    }
}

async function submitCashOutRequest() {
    if (!STATE.pendingCashOut) return;
    const { amount, grams } = STATE.pendingCashOut;
    
    const method = document.querySelector('input[name="payout-method"]:checked').value;
    let payoutDetails = "";
    
    if (method === 'UPI') {
        const upiId = document.getElementById('payout-upi-id').value.trim();
        if (!upiId) return alert("Please enter your UPI ID.");
        payoutDetails = `UPI ID: ${upiId}`;
    } else {
        const holder = document.getElementById('payout-bank-holder').value.trim();
        const number = document.getElementById('payout-bank-number').value.trim();
        const ifsc = document.getElementById('payout-bank-ifsc').value.trim();
        if (!holder || !number || !ifsc) {
            return alert("Please enter all Bank Account details.");
        }
        payoutDetails = `Bank Account: ${number} (IFSC: ${ifsc}, Holder: ${holder})`;
    }
    
    // Deduct grams
    STATE.profile.digi_silver_balance = parseFloat((STATE.profile.digi_silver_balance - grams).toFixed(4));
    
    alert(`Success! You have requested to cash out ₹${amount} (${grams}g). The funds will be transferred to your registered ${method} account in 1-2 working days.`);
    
    // Save deduction to Supabase Profile (settings)
    if (STATE.user && STATE.user.email) {
        try {
            const { data } = await supaClient.from('settings').select('value').eq('key', 'user_' + STATE.user.email).single();
            if (data && data.value) {
                const ud = JSON.parse(data.value);
                ud.digi_silver_balance = STATE.profile.digi_silver_balance;
                await supaClient.from('settings').update({ value: JSON.stringify(ud) }).eq('key', 'user_' + STATE.user.email);
            }
        } catch(e) {
            console.error("Error saving profile balance:", e);
        }
    }
    
    // Save to Order History
    const sellOrderId = `UVR-SELL-${Math.floor(1000 + Math.random() * 9000)}`;
    const newOrder = {
        id: sellOrderId,
        date: new Date().toISOString().split("T")[0],
        customer: JSON.stringify({ name: STATE.user && STATE.user.name ? STATE.user.name : "Digi Seller", email: STATE.user ? STATE.user.email : null, token: STATE.user ? STATE.user.token : null }),
        phone: localStorage.getItem("mrt_checkout_phone") || "",
        address: `Digi Silver Cash Out to ${method}. Payout details: ${payoutDetails}`,
        paymentMethod: `${method} Payout`,
        subtotal: amount,
        discount: 0,
        total: amount,
        status: "Processing (1-2 days)",
        items: JSON.stringify([{
            title: `Sold ${grams}g Digi Silver`,
            price: amount,
            qty: 1,
            isDigiSilver: false
        }])
    };
    
    STATE.orders.push(newOrder);
    supaClient.from('orders').insert({
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
    }).then().catch(e=>console.error(e));
    
    document.getElementById('sell-digi-amount').value = "";
    closeCashOutModal();
    updateProfileUI();
}

// --- KYC (Aadhar & PAN) Logic ---
let aadharCallback = null;
let panCallback = null;

function openAadharModal(callback) {
    aadharCallback = callback;
    document.getElementById('aadhar-modal-overlay').style.display = 'block';
    document.getElementById('aadhar-modal').style.display = 'block';
    document.getElementById('kyc-aadhar-input').value = '';
    document.getElementById('aadhar-error-msg').style.display = 'none';
    
    // Clear uploads
    document.getElementById('aadhar-front-file').value = '';
    document.getElementById('aadhar-back-file').value = '';
    document.getElementById('aadhar-front-preview').style.display = 'none';
    document.getElementById('aadhar-back-preview').style.display = 'none';
    document.getElementById('aadhar-front-label').style.display = 'inline';
    document.getElementById('aadhar-front-label').textContent = 'Click to Upload';
    document.getElementById('aadhar-back-label').style.display = 'inline';
    document.getElementById('aadhar-back-label').textContent = 'Click to Upload';
    document.getElementById('aadhar-file-error-msg').style.display = 'none';
}

function closeAadharModal() {
    document.getElementById('aadhar-modal-overlay').style.display = 'none';
    document.getElementById('aadhar-modal').style.display = 'none';
    aadharCallback = null;
}

function openPanModal(callback) {
    panCallback = callback;
    document.getElementById('pan-modal-overlay').style.display = 'block';
    document.getElementById('pan-modal').style.display = 'block';
    document.getElementById('kyc-pan-input').value = '';
    document.getElementById('pan-error-msg').style.display = 'none';
}

function closePanModal() {
    document.getElementById('pan-modal-overlay').style.display = 'none';
    document.getElementById('pan-modal').style.display = 'none';
    panCallback = null;
}

function previewAadharPhoto(input, imgId, labelId) {
    const file = input.files[0];
    const preview = document.getElementById(imgId);
    const label = document.getElementById(labelId);
    
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            preview.src = e.target.result;
            preview.style.display = 'block';
            label.style.display = 'none';
        }
        reader.readAsDataURL(file);
    } else {
        preview.style.display = 'none';
        label.style.display = 'inline';
        label.textContent = 'Click to Upload';
    }
}

// Format Aadhar input as "xxxx xxxx xxxx"
document.getElementById('kyc-aadhar-input').addEventListener('input', function(e) {
    let value = e.target.value.replace(/\D/g, '');
    let formatted = '';
    for (let i = 0; i < value.length && i < 12; i++) {
        if (i > 0 && i % 4 === 0) formatted += ' ';
        formatted += value[i];
    }
    e.target.value = formatted;
});

// Aadhar Validation
async function verifyAadharKYC() {
    const aadharInput = document.getElementById('kyc-aadhar-input').value.replace(/\s/g, '');
    const errorEl = document.getElementById('aadhar-error-msg');
    const fileErrorEl = document.getElementById('aadhar-file-error-msg');
    
    let hasError = false;
    
    if (aadharInput.length !== 12 || isNaN(aadharInput)) {
        errorEl.textContent = 'Please enter a valid 12-digit Aadhar number.';
        errorEl.style.display = 'block';
        hasError = true;
    } else {
        errorEl.style.display = 'none';
    }
    
    const frontFile = document.getElementById('aadhar-front-file').files[0];
    const backFile = document.getElementById('aadhar-back-file').files[0];
    
    if (!frontFile || !backFile) {
        fileErrorEl.style.display = 'block';
        hasError = true;
    } else {
        fileErrorEl.style.display = 'none';
    }
    
    if (hasError) return;
    
    try {
        if (!STATE.user) {
            alert("Please login first.");
            closeAadharModal();
            return;
        }

        document.getElementById('btn-submit-aadhar').textContent = "Uploading...";
        document.getElementById('btn-submit-aadhar').disabled = true;

        // Convert photos to data URLs
        const readerFront = new FileReader();
        readerFront.onload = function(e) {
            const frontDataUrl = e.target.result;
            const readerBack = new FileReader();
            readerBack.onload = async function(e2) {
                const backDataUrl = e2.target.result;
                
                try {
                    // Update user object locally
                    STATE.user.aadhar = aadharInput;
                    STATE.user.aadhar_front = frontFile.name;
                    STATE.user.aadhar_back = backFile.name;
                    STATE.user.aadhar_front_data = frontDataUrl;
                    STATE.user.aadhar_back_data = backDataUrl;
                    STATE.user.aadhar_status = 'pending_approval';
                    
                    // Save to Supabase
                    await supaClient.from('settings').update({ value: JSON.stringify(STATE.user) }).eq('key', 'user_' + STATE.user.email);
                    
                    alert("Aadhar submitted successfully! It is now pending admin approval.");
                    closeAadharModal();
                    updateProfileUI();
                    
                    if (aadharCallback) {
                        const cb = aadharCallback;
                        aadharCallback = null;
                        cb();
                    }
                } catch(err) {
                    console.error("Error saving user state:", err);
                    alert("Error saving Aadhar verification: " + err.message);
                } finally {
                    document.getElementById('btn-submit-aadhar').textContent = "Verify & Proceed";
                    document.getElementById('btn-submit-aadhar').disabled = false;
                }
            };
            readerBack.readAsDataURL(backFile);
        };
        readerFront.readAsDataURL(frontFile);
        
    } catch(e) {
        console.error("KYC verification error:", e);
        errorEl.textContent = 'Failed to verify Aadhar. Please try again.';
        errorEl.style.display = 'block';
        document.getElementById('btn-submit-aadhar').textContent = "Verify & Proceed";
        document.getElementById('btn-submit-aadhar').disabled = false;
    }
}

// PAN Validation
async function verifyPanKYC() {
    const panInput = document.getElementById('kyc-pan-input').value.trim().toUpperCase();
    const errorEl = document.getElementById('pan-error-msg');
    
    // PAN regex: 5 letters, 4 digits, 1 letter
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    if (!panRegex.test(panInput)) {
        errorEl.textContent = 'Please enter a valid 10-character alphanumeric PAN number (e.g. ABCDE1234F).';
        errorEl.style.display = 'block';
        return;
    }
    
    errorEl.style.display = 'none';
    
    try {
        if (!STATE.user) {
            alert("Please login first.");
            closePanModal();
            return;
        }
        
        // Save to user object
        STATE.user.pan = panInput;
        STATE.user.pan_status = 'pending_approval';
        
        // Save to Supabase
        await supaClient.from('settings').update({ value: JSON.stringify(STATE.user) }).eq('key', 'user_' + STATE.user.email);
        
        alert("PAN card submitted successfully! It is now pending admin approval.");
        closePanModal();
        updateProfileUI();
        
        if (panCallback) {
            const cb = panCallback;
            panCallback = null;
            cb();
        }
    } catch(e) {
        console.error("KYC verification error:", e);
        errorEl.textContent = 'Failed to verify PAN. Please try again.';
        errorEl.style.display = 'block';
    }
}

// Admin KYC Functions
async function approveAadhar(email) {
    if (!confirm(`Are you sure you want to approve Aadhar for ${email}?`)) return;
    try {
        const { data } = await supaClient.from('settings').select('value').eq('key', 'user_' + email).single();
        if (!data || !data.value) return alert("User not found.");
        const userRec = JSON.parse(data.value);
        userRec.aadhar_status = 'approved';
        
        await supaClient.from('settings').update({ value: JSON.stringify(userRec) }).eq('key', 'user_' + email);
        alert(`Aadhar approved for ${email}`);
        
        if (STATE.user && STATE.user.email === email) {
            STATE.user.aadhar_status = 'approved';
        }
        
        loadAdminUsers();
    } catch(e) {
        console.error(e);
        alert("Error approving Aadhar: " + e.message);
    }
}

async function approvePan(email) {
    if (!confirm(`Are you sure you want to approve PAN for ${email}?`)) return;
    try {
        const { data } = await supaClient.from('settings').select('value').eq('key', 'user_' + email).single();
        if (!data || !data.value) return alert("User not found.");
        const userRec = JSON.parse(data.value);
        userRec.pan_status = 'approved';
        
        await supaClient.from('settings').update({ value: JSON.stringify(userRec) }).eq('key', 'user_' + email);
        alert(`PAN approved for ${email}`);
        
        if (STATE.user && STATE.user.email === email) {
            STATE.user.pan_status = 'approved';
        }
        
        loadAdminUsers();
    } catch(e) {
        console.error(e);
        alert("Error approving PAN: " + e.message);
    }
}

function viewKycDoc(email, side) {
    const user = STATE.adminUsers.find(u => u.email === email);
    if (!user) return alert("User not found.");
    const dataUrl = (side === 'front') ? user.aadhar_front_data : user.aadhar_back_data;
    if (!dataUrl) return alert("Image not available.");
    
    // Open image in a new browser tab/window
    const newTab = window.open();
    newTab.document.write(`<img src="${dataUrl}" style="max-width:100%; max-height:100%; display:block; margin:auto;" />`);
}

document.getElementById('btn-submit-aadhar').addEventListener('click', verifyAadharKYC);
document.getElementById('btn-submit-pan').addEventListener('click', verifyPanKYC);

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function renderAdminTdsReport() {
    const tbody = document.getElementById("admin-tds-tbody");
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px;">Loading TDS records...</td></tr>';
    
    try {
        const { data, error } = await supaClient.from('settings').select('*').like('key', 'user_%');
        if (error) throw error;
        
        const tdsRecords = [];
        
        if (data) {
            data.forEach(row => {
                let record = {};
                try {
                    record = JSON.parse(row.value);
                } catch(e) {
                    record = {};
                }
                
                if (record && typeof record === 'object') {
                    const commissions = Array.isArray(record.referral_commissions) ? record.referral_commissions : [];
                    const tdsRedemptions = Array.isArray(record.tds_redemptions) ? record.tds_redemptions : [];
                    
                    const redeemedCommissions = commissions.filter(c => c && c.is_redeemed);
                    const accountedTds = [...tdsRedemptions].filter(r => r && typeof r === 'object');
                    
                    const totalRedeemedGross = redeemedCommissions.reduce((sum, c) => sum + (c.commission_amount || 0), 0);
                    const totalTdsGross = accountedTds.reduce((sum, r) => sum + (parseFloat(r.gross_amount) || 0), 0);
                    const diff = totalRedeemedGross - totalTdsGross;
                    
                    if (diff > 0.01) {
                        const legacyTds = parseFloat((diff * 0.10).toFixed(2));
                        const legacyNet = parseFloat((diff * 0.90).toFixed(2));
                        let latestRedeemedDate = new Date().toISOString();
                        let hasValidDate = false;
                        redeemedCommissions.forEach(c => {
                            if (c && c.redeemed_date) {
                                if (!hasValidDate || new Date(c.redeemed_date) > new Date(latestRedeemedDate)) {
                                    latestRedeemedDate = c.redeemed_date;
                                    hasValidDate = true;
                                }
                            }
                        });
                        
                        accountedTds.push({
                            redemption_date: latestRedeemedDate,
                            gross_amount: diff,
                            tds_amount: legacyTds,
                            net_amount: legacyNet,
                            coupon_code: 'LEGACY-REF-MIGRATE'
                        });
                    }
                    
                    accountedTds.forEach(r => {
                        tdsRecords.push({
                            date: r.redemption_date || 'N/A',
                            name: record.name || 'N/A',
                            email: record.email || row.key.replace('user_', ''),
                            pan: record.pan || 'N/A',
                            gross: parseFloat(r.gross_amount) || 0,
                            tds: parseFloat(r.tds_amount) || 0,
                            net: parseFloat(r.net_amount) || 0,
                            code: r.coupon_code || 'N/A'
                        });
                    });
                }
            });
        }
        
        tdsRecords.sort((a, b) => new Date(b.date) - new Date(a.date));
        STATE.adminTdsRecords = tdsRecords;
        
        if (tdsRecords.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px;">No TDS records found.</td></tr>';
            return;
        }
        
        tbody.innerHTML = tdsRecords.map(r => `
            <tr>
                <td>${r.date !== 'N/A' ? new Date(r.date).toLocaleString() : 'N/A'}</td>
                <td><strong>${escapeHtml(r.name)}</strong></td>
                <td>${escapeHtml(r.email)}</td>
                <td><span style="font-family: monospace; font-weight: bold; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${escapeHtml(r.pan)}</span></td>
                <td>₹${r.gross.toFixed(2)}</td>
                <td style="color: #EF4444; font-weight: 700;">₹${r.tds.toFixed(2)}</td>
                <td style="color: #10B981; font-weight: 700;">₹${r.net.toFixed(2)}</td>
                <td><span style="font-family: monospace; font-weight: bold; background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px;">${escapeHtml(r.code)}</span></td>
            </tr>
        `).join('');
    } catch(err) {
        console.error("Error rendering TDS report:", err);
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: red;">Failed to load TDS records: ${err.message}</td></tr>`;
    }
}

function downloadTdsReportPdf() {
    const records = STATE.adminTdsRecords || [];
    if (records.length === 0) {
        alert("No TDS records available to download.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Top Accent line (Premium solid black)
    doc.setFillColor(0, 0, 0);
    doc.rect(0, 0, 210, 5, 'F');

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("UVIRA JEWELS", 15, 20);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text("TDS Ledger - Refer & Earn Program", 15, 26);

    // Metadata
    const now = new Date();
    doc.setFontSize(9);
    doc.text(`Report Generated: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`, 130, 20);
    doc.text("Tax Deduction: 10% TDS on Redemptions", 130, 25);

    let y = 35;
    doc.setLineWidth(0.3);
    doc.line(15, y, 195, y);
    y += 8;

    // Totals Calculation
    const totalGross = records.reduce((sum, r) => sum + r.gross, 0);
    const totalTds = records.reduce((sum, r) => sum + r.tds, 0);
    const totalNet = records.reduce((sum, r) => sum + r.net, 0);

    // Summary Cards
    doc.setFillColor(248, 250, 252);
    doc.rect(15, y, 180, 20, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.rect(15, y, 180, 20, 'S');

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text("TOTAL GROSS REDEEMED", 20, y + 6);
    doc.text("TOTAL 10% TDS COLLECTED", 80, y + 6);
    doc.text("TOTAL NET VOUCHERS", 145, y + 6);

    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(`INR ${totalGross.toFixed(2)}`, 20, y + 14);
    doc.setTextColor(239, 68, 68);
    doc.text(`INR ${totalTds.toFixed(2)}`, 80, y + 14);
    doc.setTextColor(16, 185, 129);
    doc.text(`INR ${totalNet.toFixed(2)}`, 145, y + 14);

    y += 28;

    // Table Header
    doc.setFillColor(0, 0, 0);
    doc.rect(15, y, 180, 7, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("Date", 17, y + 5);
    doc.text("Customer / Email", 47, y + 5);
    doc.text("PAN", 97, y + 5);
    doc.text("Gross (INR)", 122, y + 5);
    doc.text("TDS (INR)", 147, y + 5);
    doc.text("Net Coupon", 172, y + 5);
    y += 12;

    // Table Body
    doc.setFont("helvetica", "normal");
    doc.setTextColor(50, 50, 50);
    records.forEach(r => {
        if (y > 275) {
            doc.addPage();
            doc.setFillColor(0, 0, 0);
            doc.rect(0, 0, 210, 4, 'F');
            y = 20;
        }
        
        const dateStr = r.date !== 'N/A' ? new Date(r.date).toLocaleDateString() : 'N/A';
        doc.text(dateStr, 17, y);
        
        const emailTrunc = r.email.length > 20 ? r.email.substring(0, 18) + ".." : r.email;
        doc.text(`${r.name}\n(${emailTrunc})`, 47, y - 1);
        
        doc.text(r.pan, 97, y);
        doc.text(r.gross.toFixed(2), 122, y);
        
        doc.setTextColor(200, 30, 30);
        doc.text(r.tds.toFixed(2), 147, y);
        
        doc.setTextColor(30, 150, 30);
        doc.text(`${r.net.toFixed(2)}\n[${r.code}]`, 172, y - 1);
        
        doc.setTextColor(50, 50, 50);
        y += 11;
    });

    doc.save(`TDS_Report_${now.getFullYear()}_${now.getMonth() + 1}_${now.getDate()}.pdf`);
}
