document.addEventListener("DOMContentLoaded", () => {
  const WISHLIST_API = 'https://wishlist-bridge.pratham-bb7.workers.dev';
  const grid = document.getElementById('wishlist-grid');
  const clearBtn = document.getElementById('clear-all-wishlist');

  console.log("Wishlist Script Loaded - Listening for clicks...");

  // --- 1. CART SYNC LOGIC (Keep existing) ---
  if (grid) {
    grid.addEventListener('mousedown', async (e) => {
      const btn = e.target.closest('button[name="plus"], button[name="minus"]');
      if (!btn || !grid.contains(btn)) return;
      // ... (Your existing cart logic handles this fine)
      
      e.preventDefault();
      e.stopPropagation();

      const card = btn.closest('.grid__item');
      const idInput = card.querySelector('input[name="id"]');
      const qtyInput = card.querySelector('input[name="quantity"]');
      if (!idInput || !qtyInput) return;

      const variantId = idInput.value;
      const isPlus = btn.name === 'plus';

      const cart = await fetch('/cart.js').then(res => res.json());
      let currentInCart = 0;
      const itemInCart = cart.items.find(item => item.id == variantId);
      if (itemInCart) currentInCart = itemInCart.quantity;

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
      } catch (err) { console.error("Wishlist Update Error:", err); }
    }, true);
  }

  // --- 2. GLOBAL HEART BUTTON HANDLER (FIXED) ---
  // Added ', true' at the end to force Capture Phase
  document.body.addEventListener('click', async (e) => {
    const heartBtn = e.target.closest('.wishlist-btn');
    if (!heartBtn) return; // If not a heart button, ignore.

    console.log("Heart Click Detected!"); // DEBUG LOG

    e.preventDefault();
    e.stopPropagation(); // Stop other theme scripts from interfering

    const productId = heartBtn.dataset.productId;
    const customerId = heartBtn.dataset.customerId;
    
    // Check if data is present
    if (!customerId || customerId === "") {
        console.log("No Customer ID found. Redirecting to login...");
        window.location.href = '/account/login';
        return;
    }

    // Toggle state visually
    const isAdding = !heartBtn.classList.contains('is-active');
    heartBtn.classList.toggle('is-active');
    
    // If we are on the wishlist page and removing, fade out the card immediately
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
          action: isAdding ? 'add' : 'remove' 
        })
      });

      if (response.ok) {
        // TRIGGER TOAST
        showToast(
            isAdding ? "Added to Favorites" : "Removed from Favorites", 
            isAdding ? "success" : "danger"
        );

        // Remove from grid if we are on the wishlist page
        if (!isAdding && grid && grid.contains(heartBtn)) {
          cardItem.remove();
          if (grid.querySelectorAll('.grid__item').length === 0) window.location.reload();
        }
      } else {
        console.error("Server responded with error");
        // Revert visual if server fails
        heartBtn.classList.toggle('is-active');
        if (cardItem) cardItem.style.opacity = '1';
        showToast("Something went wrong", "danger");
      }
    } catch (err) { 
      console.error("Wishlist Sync Error:", err);
      heartBtn.classList.toggle('is-active');
      showToast("Connection Error", "danger");
    }
  }, true); // <--- THIS 'true' IS CRITICAL

  // --- 3. CLEAR ALL LOGIC ---
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (!confirm("Are you sure you want to clear all favorites?")) return;

      // Try to find customer ID from a visible button, or use a fallback if available
      let customerId = null;
      const firstHeart = document.querySelector('.wishlist-btn');
      if (firstHeart) {
        customerId = firstHeart.dataset.customerId;
      } else if (window.wishlistCustomerId) {
        customerId = window.wishlistCustomerId; // Fallback if grid is empty but user is logged in
      }

      if (!customerId) {
        alert("Could not identify account. Please add an item first.");
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
          clearBtn.textContent = "Clear All Favorites";
          clearBtn.disabled = false;
        }
      } catch (err) { console.error("Clear all error:", err); }
    });
  }

  // --- 4. NEW: ADD ALL TO CART (B2B Feature) ---
  const addAllBtn = document.getElementById('add-all-to-cart');
  
  if (addAllBtn) {
    addAllBtn.addEventListener('click', async () => {
      // 1. Find all Variant IDs currently on the screen
      const allIdInputs = grid.querySelectorAll('input[name="id"]');
      if (allIdInputs.length === 0) return;

      // 2. Build the "Items" array for Shopify
      const itemsToAdd = [];
      allIdInputs.forEach(input => {
        const val = input.value;
        if (val) {
          itemsToAdd.push({
            id: parseInt(val),
            quantity: 1 // Default to adding 1 of each
          });
        }
      });

      if (itemsToAdd.length === 0) return;

      // 3. UI Feedback
      const originalText = addAllBtn.textContent;
      addAllBtn.textContent = "Adding...";
      addAllBtn.disabled = true;

      try {
        // 4. Send Bulk Request to /cart/add.js
        const response = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({
            items: itemsToAdd,
            sections: 'cart-drawer,cart-icon-bubble' // Ask for updated HTML
          })
        });

        if (response.ok) {
          const result = await response.json();
          
          // 5. Update Cart Bubble & Drawer HTML
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

          // 6. Trigger Theme Events (Open Drawer)
          if (window.publish) {
            window.publish('cart-drawer-open');
            window.publish('cart-update', { source: 'wishlist' });
          }
          document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart: result } }));

          // 7. Success Message
          showToast(`Added ${itemsToAdd.length} items to cart!`, "success");
        } else {
          showToast("Some items could not be added.", "danger");
        }
      } catch (err) {
        console.error("Bulk Add Error:", err);
        showToast("Error adding items.", "danger");
      } finally {
        // Reset Button
        addAllBtn.textContent = originalText;
        addAllBtn.disabled = false;
      }
    });
  }

  if (grid) renderWishlistPage();

  // --- HELPER: TOAST ---
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

// --- ADD THIS TO THE BOTTOM OF wishlist.js ---

async function renderWishlistPage() {
  const grid = document.getElementById('wishlist-grid');
  const emptyMsg = document.getElementById('wishlist-empty');
  const sidebar = document.getElementById('wishlist-filters');
  const countDisplay = document.getElementById('wishlist-count-display');
  const clearBtn = document.getElementById('clear-all-wishlist');
  const addAllBtn = document.getElementById('add-all-to-cart');
  const favorites = window.wishlistData || [];

  // 1. Handle Empty State
  if (favorites.length === 0) {
    if (grid) grid.parentElement.style.display = 'none'; // Hide main container
    if (emptyMsg) emptyMsg.style.display = 'block';
    return;
  }

  // 2. Render Cards
  grid.innerHTML = ''; 
  const productCards = []; // Store elements for easier sorting later
  
  for (const productObj of favorites) {
    try {
      const response = await fetch(`/products/${productObj.handle}?view=wishlist-item`);
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const cardWrapper = doc.querySelector('.grid__item');
      
      if (cardWrapper) {
        grid.appendChild(cardWrapper);
        productCards.push(cardWrapper); // Keep track for JS logic
      }
    } catch (e) { console.error("Item load fail:", e); }
  }

  // 3. Initialize Sidebar & Toolbar
  if (sidebar) sidebar.style.display = 'block';
  if (clearBtn) clearBtn.style.display = 'inline-block';
  if (addAllBtn) addAllBtn.style.display = 'inline-block';
  updateCount(productCards.length);

  // 4. Extract Data & Build Filters
  buildDynamicFilters(productCards);

  // 5. Setup Event Listeners
  setupFilterListeners(productCards);
  setupSortListener(productCards, grid);
}

// --- FILTERING LOGIC (No Tags) ---

function buildDynamicFilters(cards) {
  const vendors = new Set();
  const collections = new Set();

  // Scrape data from DOM
  cards.forEach(card => {
    // 1. Get Vendors
    if (card.dataset.vendor) vendors.add(card.dataset.vendor);
    
    // 2. Get Collections
    if (card.dataset.collections) {
      card.dataset.collections.split('||').forEach(c => c.trim() !== '' && collections.add(c.trim()));
    }
  });

  // Render Checkboxes
  renderCheckboxList('filter-vendor-list', Array.from(vendors).sort(), 'vendor');
  renderCheckboxList('filter-collection-list', Array.from(collections).sort(), 'collection');
}

function renderCheckboxList(containerId, items, type) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  if (items.length === 0) {
    container.innerHTML = '<div style="padding:5px; color:#999; font-size:12px;">None available</div>';
    return;
  }

  container.innerHTML = items.map(item => `
    <label class="filter-item">
      <input type="checkbox" value="${item}" class="filter-checkbox" data-type="${type}">
      ${item}
    </label>
  `).join('');
}

function setupFilterListeners(cards) {
  const checkboxes = document.querySelectorAll('.filter-checkbox');
  checkboxes.forEach(box => {
    box.addEventListener('change', () => applyFilters(cards));
  });
}

function applyFilters(cards) {
  // Get active filters
  const checked = Array.from(document.querySelectorAll('.filter-checkbox:checked'));
  const filters = {
    vendor: checked.filter(c => c.dataset.type === 'vendor').map(c => c.value),
    collection: checked.filter(c => c.dataset.type === 'collection').map(c => c.value),
    stock: checked.some(c => c.dataset.type === 'stock') // True if 'In Stock' is checked
  };

  let visibleCount = 0;

  cards.forEach(card => {
    const cardVendor = card.dataset.vendor;
    const cardCollections = card.dataset.collections || "";
    
    // 1. Vendor Match
    const matchesVendor = filters.vendor.length === 0 || filters.vendor.includes(cardVendor);
    
    // 2. Collection Match
    const matchesCollection = filters.collection.length === 0 || filters.collection.some(c => cardCollections.includes(c));
    
    // 3. Stock Match (Real Logic)
    // If filter is OFF, it matches everything. If ON, card must have data-available="true".
    const matchesStock = !filters.stock || (card.dataset.available === 'true');

    if (matchesVendor && matchesCollection && matchesStock) {
      card.classList.remove('hidden');
      visibleCount++;
    } else {
      card.classList.add('hidden');
    }
  });

  updateCount(visibleCount);
}

function updateCount(count) {
  const display = document.getElementById('wishlist-count-display');
  if (display) display.textContent = `${count} products`;
}

// --- SORTING LOGIC ---

function setupSortListener(cards, grid) {
  const select = document.getElementById('wishlist-sort-select');
  if (!select) return;

  select.addEventListener('change', (e) => {
    const sortValue = e.target.value;
    
    // Convert NodeList to Array to sort
    const sortedCards = cards.sort((a, b) => {
      const priceA = parseFloat(a.dataset.price) || 0;
      const priceB = parseFloat(b.dataset.price) || 0;
      const titleA = (a.dataset.title || '').toLowerCase();
      const titleB = (b.dataset.title || '').toLowerCase();

      switch (sortValue) {
        case 'price-asc': return priceA - priceB;
        case 'price-desc': return priceB - priceA;
        case 'alpha-asc': return titleA.localeCompare(titleB);
        case 'alpha-desc': return titleB.localeCompare(titleA);
        default: return 0; // Keep original order
      }
    });

    // Re-append in new order
    sortedCards.forEach(card => grid.appendChild(card));
  });
}