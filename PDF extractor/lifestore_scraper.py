from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager
from bs4 import BeautifulSoup
from fpdf import FPDF
import time

BASE_URL = "https://lifestore.lk"
CATALOG_URL = "https://lifestore.lk/categories?page=" 

def setup_browser():
    # Set up Chrome options
    chrome_options = Options()
    # Uncomment the line below if you want the browser to run invisibly in the background
    # chrome_options.add_argument("--headless") 
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--window-size=1920,1080")
    chrome_options.add_argument('--ignore-certificate-errors')
    chrome_options.add_argument('--allow-running-insecure-content')
    
    # Initialize the Chrome driver
    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=chrome_options)
    return driver

def get_product_details(html_content, product_url):
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        
        title_elem = soup.find('h1', class_='product-title')
        title = title_elem.text.strip() if title_elem else "Unknown Product"
        
        price_elem = soup.find('span', class_='price')
        price = price_elem.text.strip() if price_elem else "N/A"
        
        desc_elem = soup.find('div', class_='product-description')
        description = desc_elem.text.strip() if desc_elem else "No description available."
        
        return {
            "name": title,
            "price": price,
            "description": description,
            "url": product_url
        }
    except Exception as e:
        print(f"Parsing error on {product_url}: {e}")
        return None

def scrape_all_products():
    all_products = []
    page = 1
    driver = setup_browser()
    
    try:
        while True:
            print(f"Scraping page {page}...")
            page_url = f"{CATALOG_URL}{page}"
            driver.get(page_url)
            
            # Wait for the page to fully render (useful for JavaScript-heavy sites)
            time.sleep(4)
            
            soup = BeautifulSoup(driver.page_source, 'html.parser')
            
            # NOTE: Update 'product-link-class' to the actual class used on lifestore.lk
            product_links = soup.find_all('a', class_='product-link-class') 
            
            if not product_links:
                print("No product links found on this page. Finishing scrape.")
                break 
                
            for link in product_links:
                href = link.get('href')
                if href:
                    full_url = BASE_URL + href if not href.startswith('http') else href
                    
                    # Navigate to individual product page
                    driver.get(full_url)
                    time.sleep(3) # Wait for product page to load
                    
                    product_data = get_product_details(driver.page_source, full_url)
                    if product_data:
                        all_products.append(product_data)
                        
            page += 1
            
            # Fail-safe break for testing
            if page > 5: 
                break
                
    except Exception as e:
        print(f"An error occurred during scraping: {e}")
    finally:
        # Always make sure the browser closes when done
        driver.quit()
            
    return all_products

def generate_pdf(products, output_filename="all_lifestore_products.pdf"):
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    
    pdf.set_font("helvetica", "B", 18)
    pdf.set_text_color(11, 79, 140)
    pdf.cell(0, 10, "LifeStore Complete Product Catalog", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(10)
    
    for p in products:
        pdf.set_font("helvetica", "B", 12)
        pdf.set_text_color(0, 0, 0)
        clean_name = p['name'].encode('latin-1', 'replace').decode('latin-1')
        pdf.multi_cell(0, 8, f"Product: {clean_name}")
        
        pdf.set_font("helvetica", "B", 11)
        pdf.set_text_color(47, 133, 90) 
        clean_price = p['price'].encode('latin-1', 'replace').decode('latin-1')
        pdf.cell(0, 8, f"Price: {clean_price}", new_x="LMARGIN", new_y="NEXT")
        
        pdf.set_font("helvetica", "", 10)
        pdf.set_text_color(85, 85, 85) 
        clean_desc = p['description'].encode('latin-1', 'replace').decode('latin-1')
        pdf.multi_cell(0, 6, f"Description: {clean_desc}")
        pdf.ln(8) 
        
    print("Generating PDF...")
    pdf.output(output_filename)
    print(f"Done! PDF saved as {output_filename}")

if __name__ == "__main__":
    print("Starting extraction using Selenium...")
    extracted_products = scrape_all_products()
    
    if extracted_products:
        generate_pdf(extracted_products)
    else:
        print("No products extracted. Check the HTML tags in the BeautifulSoup setup!")