-- ========================================================
-- UVIRA JEWELS - SUPABASE DATABASE SCHEMA SETUP
-- Run this SQL in your Supabase SQL Editor:
-- Dashboard -> SQL Editor -> New Query -> Run
-- ========================================================

-- 1. PRODUCTS TABLE
CREATE TABLE IF NOT EXISTS public.products (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    price NUMERIC NOT NULL,
    original_price NUMERIC,
    rating NUMERIC DEFAULT 5.0,
    reviews_count INTEGER DEFAULT 0,
    plating TEXT,
    in_stock BOOLEAN DEFAULT TRUE,
    image TEXT,
    description TEXT,
    specs JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. COUPONS TABLE
CREATE TABLE IF NOT EXISTS public.coupons (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    discount NUMERIC DEFAULT 0,
    discount_percent NUMERIC DEFAULT 0,
    max_uses INTEGER DEFAULT 1,
    current_uses INTEGER DEFAULT 0,
    owner_email TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. LIVE RATES TABLE
CREATE TABLE IF NOT EXISTS public.rates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sterling_price_per_gram NUMERIC DEFAULT 98,
    fine_price_per_gram NUMERIC DEFAULT 105,
    gold_price_per_gram NUMERIC DEFAULT 7200,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Seed initial live rates row if empty
INSERT INTO public.rates (sterling_price_per_gram, fine_price_per_gram, gold_price_per_gram)
SELECT 98, 105, 7200
WHERE NOT EXISTS (SELECT 1 FROM public.rates);

-- 4. ORDERS TABLE
CREATE TABLE IF NOT EXISTS public.orders (
    id TEXT PRIMARY KEY,
    customer TEXT,
    phone TEXT,
    address TEXT,
    items JSONB DEFAULT '[]'::jsonb,
    subtotal NUMERIC DEFAULT 0,
    discount NUMERIC DEFAULT 0,
    total NUMERIC DEFAULT 0,
    gst_amount NUMERIC DEFAULT 0,
    shipping NUMERIC DEFAULT 0,
    digi_subtotal NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'placed',
    payment_screenshot TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. SETTINGS TABLE (Store Configurations & Banners)
CREATE TABLE IF NOT EXISTS public.settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Seed default settings if empty
INSERT INTO public.settings (key, value) VALUES
('admin_password', 'admin123'),
('admin_upi_id', '9825098250@upi'),
('hero_title', 'EMBODY THE ELEGANCE OF STERLING SILVER'),
('hero_subtitle', 'Handcrafted 925 Hallmark Certified Creations')
ON CONFLICT (key) DO NOTHING;

-- ========================================================
-- ENABLE ROW LEVEL SECURITY (RLS) & ACCESS POLICIES
-- ========================================================

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Allow full public read/write access for website operations
CREATE POLICY "Public Read/Write Products" ON public.products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Read/Write Coupons" ON public.coupons FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Read/Write Rates" ON public.rates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Read/Write Settings" ON public.settings FOR ALL USING (true) WITH CHECK (true);

-- ========================================================
-- STORAGE BUCKETS (Product Images & Banners)
-- ========================================================
INSERT INTO storage.buckets (id, name, public) 
VALUES ('product-images', 'product-images', true), ('banners', 'banners', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public Access Storage Product Images" ON storage.objects FOR ALL USING (bucket_id = 'product-images') WITH CHECK (bucket_id = 'product-images');
CREATE POLICY "Public Access Storage Banners" ON storage.objects FOR ALL USING (bucket_id = 'banners') WITH CHECK (bucket_id = 'banners');
