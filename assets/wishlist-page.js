document.addEventListener('DOMContentLoaded', () => {
  const handles = window.wishlistData || [];
  const grid = document.getElementById('WishlistGrid');

  if (handles.length === 0) {
    grid.innerHTML = '<p>You haven\'t saved any items yet.</p>';
    return;
  }

  // 1. Construct Search Query to fetch data
  // Limit to 50 items to avoid URL length limits
  const query = handles.slice(0, 50).map(h => `handle:${h}`).join(' OR ');

  fetch(`/search?q=${query}&section_id=json-wishlist-helper`)
    .then(res => res.text())
    .then(html => {
      // 2. Parse the JSON (The section returns HTML-wrapped JSON, usually clean enough)
      const data = JSON.parse(html); // NOTE: You might need to strip outer HTML depending on theme
      
      renderPage(data);
    });
});

let allProducts = [];
let activeFilters = { vendor: [], tag: [] };

function renderPage(products) {
  allProducts = products;
  buildFilters(products);
  renderGrid(products);
}

// === A. BUILD FILTERS ===
function buildFilters(products) {
  const vendors = [...new Set(products.map(p => p.vendor))];
  const tags = [...new Set(products.flatMap(p => p.tags))];

  createCheckboxGroup('filter-vendor-container', vendors, 'vendor');
  createCheckboxGroup('filter-tag-container', tags, 'tag');
}

function createCheckboxGroup(containerId, items, type) {
  const container = document.getElementById(containerId);
  container.innerHTML = items.map(item => `
    <label>
      <input type="checkbox" value="${item}" onchange="toggleFilter('${type}', '${item}')"> 
      ${item}
    </label><br>
  `).join('');
}

// === B. HANDLE FILTERING ===
window.toggleFilter = (type, value) => {
  const index = activeFilters[type].indexOf(value);
  if (index > -1) activeFilters[type].splice(index, 1);
  else activeFilters[type].push(value);
  
  // Filter Logic
  const filtered = allProducts.filter(p => {
    const vendorMatch = activeFilters.vendor.length === 0 || activeFilters.vendor.includes(p.vendor);
    const tagMatch = activeFilters.tag.length === 0 || p.tags.some(t => activeFilters.tag.includes(t));
    return vendorMatch && tagMatch;
  });

  renderGrid(filtered);
};

// === C. RENDER PRODUCTS ===
function renderGrid(products) {
  const grid = document.getElementById('WishlistGrid');
  grid.innerHTML = products.map(p => `
    <div class="wishlist-card">
      <img src="${p.image}" alt="${p.title}">
      <h4>${p.title}</h4>
      <p>${p.vendor} - $${p.price}</p>
      
      <button onclick="addToCart(${p.variants[0].id})" class="btn-add-cart">
        Add to Cart
      </button>
    </div>
  `).join('');
}

// === D. ADD TO CART ===
window.addToCart = (variantId) => {
  let formData = { 'items': [{ 'id': variantId, 'quantity': 1 }] };
  
  fetch(window.Shopify.routes.root + 'cart/add.js', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData)
  })
  .then(() => {
    alert('Added to cart!'); // Replace with your Drawer Cart trigger
  });
};