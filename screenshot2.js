const puppeteer = require('puppeteer');
const express = require('express');
const path = require('path');

const app = express();
app.use(express.static(__dirname));

const server = app.listen(0, async () => {
    const port = server.address().port;
    const url = `http://localhost:${port}/`;
    
    console.log(`Server listening on ${url}`);
    
    try {
        const browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();
        
        // Set viewport width and height
        await page.setViewport({ width: 1200, height: 900 });
        
        await page.goto(url, { waitUntil: 'networkidle0' });
        
        // Scroll a bit so the gender banners are in view where the stats used to be
        await page.evaluate(() => {
            window.scrollBy(0, 500);
        });
        
        // Wait a second for smooth scrolling/animations
        await new Promise(r => setTimeout(r, 1000));
        
        const outputPath = path.join('C:\\Users\\aifut\\.gemini\\antigravity\\brain\\63856765-2276-4367-b1ed-557e20fcfaa2\\artifacts', 'latest_web_ss.png');
        await page.screenshot({ path: outputPath, fullPage: false });
        
        console.log(`Screenshot saved to ${outputPath}`);
        await browser.close();
    } catch (e) {
        console.error("Error:", e);
    } finally {
        server.close();
        process.exit(0);
    }
});
