const WISHLIST_API = 'https://wishlist-bridge.pratham-bb7.workers.dev';

document.addEventListener("DOMContentLoaded", () => {
  const grid = document.getElementById('wishlist-grid');
  const clearBtn = document.getElementById('clear-all-wishlist');

  console.log("Wishlist Script Loaded");

  // --- 1. CART SYNC LOGIC ---
  if (grid) {
    grid.addEventListener('mousedown', async (e) => {
      const btn = e.target.closest('button[name="plus"], button[name="minus"]');
      if (!btn || !grid.contains(btn)) return;

      e.preventDefault();
      e.stopPropagation();

      const card = btn.closest('.grid__item');
      const idInput = card.querySelector('input[name="id"]');
      const qtyInput = card.querySelector('input[name="quantity"]');
      if (!idInput || !qtyInput) return;

      const variantId = idInput.value;
      const isPlus = btn.name === 'plus';

      const cart = await fetch('/cart.js').then(res => res.json());
      const itemInCart = cart.items.find(item => item.id == variantId);
      const currentInCart = itemInCart ? itemInCart.quantity : 0;
      const newQty = isPlus ? currentInCart + 1 : Math.max(0, currentInCart - 1);
      qtyInput.value = newQty;

      try {
        const response = await fetch('/cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({
            updates: { [variantId]: newQty },
            sections: 'cart-drawer,cart-icon-bubble'
          })
        });

        if (response.ok) {
          const result = await response.json();
          if (result.sections) {
            if (result.sections['cart-icon-bubble']) {
              const bubbleContainer = document.getElementById('cart-icon-bubble');
              if (bubbleContainer) bubbleContainer.innerHTML = result.sections['cart-icon-bubble'];
            }
            if (result.sections['cart-drawer']) {
              const drawerContainer = document.querySelector('cart-drawer');
              if (drawerContainer) drawerContainer.innerHTML = result.sections['cart-drawer'];
            }
          }
          if (window.publish) {
            window.publish('cart-drawer-open');
            window.publish('cart-update', { source: 'wishlist' });
          }
          document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart: result } }));
        }
      } catch (err) { console.error("Cart Update Error:", err); }
    }, true);
  }

  // --- 2. HEART BUTTON HANDLER ---
  document.body.addEventListener('click', async (e) => {
    const heartBtn = e.target.closest('.wishlist-btn');
    if (!heartBtn) return;

    e.preventDefault();
    e.stopPropagation();

    const productId = heartBtn.dataset.productId;
    const handle = heartBtn.dataset.productHandle;   // ← NEW
    const customerId = heartBtn.dataset.customerId;

    if (!customerId || customerId === "") {
      window.location.href = '/account/login';
      return;
    }

    const isAdding = !heartBtn.classList.contains('is-active');
    heartBtn.classList.toggle('is-active');

    const cardItem = heartBtn.closest('.grid__item');
    if (!isAdding && grid && grid.contains(heartBtn)) {
      if (cardItem) cardItem.style.opacity = '0.3';
    }

    try {
      const response = await fetch(WISHLIST_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          productId,
          handle,                                      // ← NEW
          action: isAdding ? 'add' : 'remove'
        })
      });

      if (response.ok) {
        showToast(
          isAdding ? "Added to Favorites" : "Removed from Favorites",
          isAdding ? "success" : "danger"
        );
        if (!isAdding && grid && grid.contains(heartBtn)) {
          cardItem.remove();
          if (grid.querySelectorAll('.grid__item').length === 0) window.location.reload();
        }
      } else {
        heartBtn.classList.toggle('is-active');
        if (cardItem) cardItem.style.opacity = '1';
        showToast("Something went wrong", "danger");
      }
    } catch (err) {
      console.error("Wishlist Sync Error:", err);
      heartBtn.classList.toggle('is-active');
      showToast("Connection Error", "danger");
    }
  }, true);

  // --- 3. CLEAR ALL ---
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (!confirm("Are you sure you want to clear all favorites?")) return;

      const customerId = window.wishlistCustomerId ||
        document.querySelector('.wishlist-btn')?.dataset.customerId;

      if (!customerId) {
        alert("Could not identify account.");
        return;
      }

      clearBtn.textContent = "Clearing...";
      clearBtn.disabled = true;

      try {
        const response = await fetch(WISHLIST_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId, action: 'clear_all' })
        });

        if (response.ok) {
          window.location.reload();
        } else {
          alert("Could not clear favorites.");
          clearBtn.textContent = "Clear All";
          clearBtn.disabled = false;
        }
      } catch (err) { console.error("Clear all error:", err); }
    });
  }

  // --- 4. ADD ALL TO CART ---
  const addAllBtn = document.getElementById('add-all-to-cart');
  if (addAllBtn) {
    addAllBtn.addEventListener('click', async () => {
      const allIdInputs = grid.querySelectorAll('input[name="id"]');
      if (allIdInputs.length === 0) return;

      const itemsToAdd = Array.from(allIdInputs)
        .map(input => parseInt(input.value))
        .filter(Boolean)
        .map(id => ({ id, quantity: 1 }));

      if (itemsToAdd.length === 0) return;

      const originalText = addAllBtn.textContent;
      addAllBtn.textContent = "Adding...";
      addAllBtn.disabled = true;

      try {
        const response = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ items: itemsToAdd, sections: 'cart-drawer,cart-icon-bubble' })
        });

        if (response.ok) {
          const result = await response.json();
          if (result.sections) {
            if (result.sections['cart-icon-bubble']) {
              const bubble = document.getElementById('cart-icon-bubble');
              if (bubble) bubble.innerHTML = result.sections['cart-icon-bubble'];
            }
            if (result.sections['cart-drawer']) {
              const drawer = document.querySelector('cart-drawer');
              if (drawer) drawer.innerHTML = result.sections['cart-drawer'];
            }
          }
          if (window.publish) {
            window.publish('cart-drawer-open');
            window.publish('cart-update', { source: 'wishlist' });
          }
          document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart: result } }));
          showToast(`Added ${itemsToAdd.length} items to cart!`, "success");
        } else {
          showToast("Some items could not be added.", "danger");
        }
      } catch (err) {
        console.error("Bulk Add Error:", err);
        showToast("Error adding items.", "danger");
      } finally {
        addAllBtn.textContent = originalText;
        addAllBtn.disabled = false;
      }
    });
  }

  if (grid) renderWishlistPage();

  // --- TOAST ---
  function showToast(message, type) {
    let toast = document.getElementById("wishlist-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "wishlist-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = "show";
    if (type) toast.classList.add(type);
    setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 3000);
  }
});

// ── WISHLIST PAGE RENDERER ──
async function renderWishlistPage() {
  const grid = document.getElementById('wishlist-grid');
  const emptyMsg = document.getElementById('wishlist-empty');
  const sidebar = document.getElementById('wishlist-filters');
  const clearBtn = document.getElementById('clear-all-wishlist');
  const addAllBtn = document.getElementById('add-all-to-cart');

  const customerId = window.wishlistCustomerId;
  if (!customerId) return;

  // ← CORE FIX: Fetch full list from worker API — no Liquid, no 50-item cap
  let favorites = [];
  try {
    const res = await fetch(WISHLIST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId, action: 'get' })
    });
    const data = await res.json();
    favorites = data.list || [];
  } catch (err) {
    console.error("Failed to load wishlist:", err);
    grid.innerHTML = '<p>Failed to load wishlist. Please refresh.</p>';
    return;
  }

  if (favorites.length === 0) {
    if (grid) grid.parentElement.style.display = 'none';
    if (emptyMsg) emptyMsg.style.display = 'block';
    return;
  }

  grid.innerHTML = '';
  const productCards = [];

  for (const productObj of favorites) {
    try {
      const response = await fetch(`/products/${productObj.handle}?view=wishlist-item`);
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const cardWrapper = doc.querySelector('.grid__item');
      if (cardWrapper) {
        grid.appendChild(cardWrapper);
        productCards.push(cardWrapper);
      }
    } catch (e) { console.error("Item load fail:", e); }
  }

  if (sidebar) sidebar.style.display = 'block';
  if (clearBtn) clearBtn.style.display = 'inline-block';
  if (addAllBtn) addAllBtn.style.display = 'inline-block';
  updateCount(productCards.length);
  buildDynamicFilters(productCards);
  setupFilterListeners(productCards);
  setupSortListener(productCards, grid);
}

function buildDynamicFilters(cards) {
  const vendors = new Set();
  const collections = new Set();
  cards.forEach(card => {
    if (card.dataset.vendor) vendors.add(card.dataset.vendor);
    if (card.dataset.collections) {
      card.dataset.collections.split('||').forEach(c => c.trim() && collections.add(c.trim()));
    }
  });
  renderCheckboxList('filter-vendor-list', Array.from(vendors).sort(), 'vendor');
  renderCheckboxList('filter-collection-list', Array.from(collections).sort(), 'collection');
}

function renderCheckboxList(containerId, items, type) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = items.length === 0
    ? '<div style="padding:5px;color:#999;font-size:12px;">None available</div>'
    : items.map(item => `
        <label class="filter-item">
          <input type="checkbox" value="${item}" class="filter-checkbox" data-type="${type}">
          ${item}
        </label>`).join('');
}

function setupFilterListeners(cards) {
  document.querySelectorAll('.filter-checkbox').forEach(box => {
    box.addEventListener('change', () => applyFilters(cards));
  });
}

function applyFilters(cards) {
  const checked = Array.from(document.querySelectorAll('.filter-checkbox:checked'));
  const filters = {
    vendor: checked.filter(c => c.dataset.type === 'vendor').map(c => c.value),
    collection: checked.filter(c => c.dataset.type === 'collection').map(c => c.value),
    stock: checked.some(c => c.dataset.type === 'stock')
  };
  let count = 0;
  cards.forEach(card => {
    const matchesVendor = !filters.vendor.length || filters.vendor.includes(card.dataset.vendor);
    const matchesCollection = !filters.collection.length || filters.collection.some(c => (card.dataset.collections || '').includes(c));
    const matchesStock = !filters.stock || card.dataset.available === 'true';
    const visible = matchesVendor && matchesCollection && matchesStock;
    card.classList.toggle('hidden', !visible);
    if (visible) count++;
  });
  updateCount(count);
}

function updateCount(count) {
  const display = document.getElementById('wishlist-count-display');
  if (display) display.textContent = `${count} products`;
}

function setupSortListener(cards, grid) {
  const select = document.getElementById('wishlist-sort-select');
  if (!select) return;
  select.addEventListener('change', (e) => {
    const val = e.target.value;
    [...cards].sort((a, b) => {
      const pA = parseFloat(a.dataset.price) || 0;
      const pB = parseFloat(b.dataset.price) || 0;
      const tA = (a.dataset.title || '').toLowerCase();
      const tB = (b.dataset.title || '').toLowerCase();
      if (val === 'price-asc') return pA - pB;
      if (val === 'price-desc') return pB - pA;
      if (val === 'alpha-asc') return tA.localeCompare(tB);
      if (val === 'alpha-desc') return tB.localeCompare(tA);
      return 0;
    }).forEach(card => grid.appendChild(card));
  });
}