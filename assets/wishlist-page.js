document.addEventListener('DOMContentLoaded', () => {
  const handles = window.wishlistData || [];
  const grid = document.getElementById('WishlistGrid');

  if (handles.length === 0) {
    grid.innerHTML = '<p>You haven\'t saved any items yet.</p>';
    return;
  }

  grid.innerHTML = '<p>Loading your wishlist...</p>';

  const CHUNK_SIZE = 50;
  const chunks = [];
  for (let i = 0; i < handles.length; i += CHUNK_SIZE) {
    chunks.push(handles.slice(i, i + CHUNK_SIZE));
  }

  Promise.all(
    chunks.map(chunk => {
      const query = chunk.map(h => `handle:${h}`).join(' OR ');
      return fetch(`/search?q=${encodeURIComponent(query)}&section_id=json-wishlist-helper`)
        .then(res => res.text())
        .then(html => JSON.parse(html));
    })
  )
  .then(results => {
    const combined = results.flat();
    combined.sort((a, b) => handles.indexOf(a.handle) - handles.indexOf(b.handle));
    renderPage(combined);
  })
  .catch(err => {
    console.error('Wishlist load error:', err);
    grid.innerHTML = '<p>Something went wrong loading your wishlist. Please refresh the page.</p>';
  });
});

let allProducts = [];
let activeFilters = { vendor: [], tag: [] };

function renderPage(products) {
  allProducts = products;
  buildFilters(products);
  renderGrid(products);
}

// === FILTERS ===
function buildFilters(products) {
  const vendors = [...new Set(products.map(p => p.vendor))].sort();
  const tags = [...new Set(products.flatMap(p => p.tags))].sort();

  createCheckboxGroup('filter-vendor-container', vendors, 'vendor');
  createCheckboxGroup('filter-tag-container', tags, 'tag');
}

function createCheckboxGroup(containerId, items, type) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = items.map(item => `
    <label>
      <input type="checkbox" value="${escapeAttr(item)}" onchange="toggleFilter('${type}', '${escapeAttr(item)}')">
      ${escapeHtml(item)}
    </label><br>
  `).join('');
}

window.toggleFilter = (type, value) => {
  const index = activeFilters[type].indexOf(value);
  if (index > -1) activeFilters[type].splice(index, 1);
  else activeFilters[type].push(value);

  const filtered = allProducts.filter(p => {
    const vendorMatch = activeFilters.vendor.length === 0 || activeFilters.vendor.includes(p.vendor);
    const tagMatch = activeFilters.tag.length === 0 || p.tags.some(t => activeFilters.tag.includes(t));
    return vendorMatch && tagMatch;
  });

  renderGrid(filtered);
};

// === GRID ===
function renderGrid(products) {
  const grid = document.getElementById('WishlistGrid');

  if (products.length === 0) {
    grid.innerHTML = '<p>No products match the selected filters.</p>';
    return;
  }

  grid.innerHTML = products.map(p => {
    const variant = p.variants && p.variants[0];
    const price = variant ? parseFloat(variant.price / 100).toFixed(2) : '—';
    const image = p.image || p.featured_image || '';
    const available = variant && variant.available;

    return `
      <div class="wishlist-card">
        ${image ? `<img src="${escapeAttr(image)}" alt="${escapeAttr(p.title)}" loading="lazy">` : '<div class="wishlist-card__no-image"></div>'}
        <h4>${escapeHtml(p.title)}</h4>
        <p>${escapeHtml(p.vendor)} — $${price}</p>
        <button
          onclick="addToCart(${variant ? variant.id : 0})"
          class="btn-add-cart"
          ${!available ? 'disabled' : ''}
        >
          ${available ? 'Add to Cart' : 'Sold Out'}
        </button>
      </div>
    `;
  }).join('');
}

// === ADD TO CART ===
window.addToCart = (variantId) => {
  if (!variantId) return;

  fetch(window.Shopify.routes.root + 'cart/add.js', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ id: variantId, quantity: 1 }] })
  })
  .then(res => {
    if (!res.ok) throw new Error('Cart error');
    alert('Added to cart!');
  })
  .catch(() => {
    alert('Could not add to cart. Please try again.');
  });
};

// === HELPERS ===
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}