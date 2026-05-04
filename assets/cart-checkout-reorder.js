(function () {
  'use strict';

  const STORAGE_KEY = 'cart_reorder_pending';

  // ─── On every page load, check if a reorder was interrupted ───
  async function resumePendingReorder() {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    sessionStorage.removeItem(STORAGE_KEY);

    let pending;
    try { pending = JSON.parse(raw); } catch { return; }

    console.log('[Cart Reorder] Resuming interrupted reorder...');
    await executeReorder(pending.items, pending.note, pending.attributes);
    window.location.href = '/checkout';
  }

  // ─── Main checkout intercept ───
  async function reorderCartAndCheckout(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const trigger = event.currentTarget;
    setLoadingState(trigger, true);

    try {
      // 1. Fetch full cart from backend
      const cartRes = await fetch('/cart.json');
      if (!cartRes.ok) throw new Error('Failed to fetch cart');
      const cart = await cartRes.json();

      // 2. Single item or empty — skip reorder, go straight to checkout
      if (!cart.items || cart.items.length <= 1) {
        window.location.href = '/checkout';
        return;
      }

      // 3. Build reordered payload (reverse = first-added-first)
      const reorderedItems = [...cart.items].reverse().map(item => {
        const entry = { id: item.variant_id, quantity: item.quantity };
        if (item.properties && Object.keys(item.properties).length > 0) {
          entry.properties = item.properties;
        }
        if (item.selling_plan_allocation?.selling_plan?.id) {
          entry.selling_plan = item.selling_plan_allocation.selling_plan.id;
        }
        return entry;
      });

      // 4. Validate all variant IDs before touching anything
      const invalid = reorderedItems.filter(i => !i.id || i.id === 0);
      if (invalid.length > 0) {
        console.warn('[Cart Reorder] Invalid variant IDs found, skipping reorder');
        window.location.href = '/checkout';
        return;
      }

      // 5. CRITICAL: Save to sessionStorage BEFORE clearing
      // If the page reloads mid-operation, resumePendingReorder() will finish the job
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        items: reorderedItems,
        note: cart.note || '',
        attributes: cart.attributes || {}
      }));

      // 6. Clear + re-add
      const success = await executeReorder(reorderedItems, cart.note, cart.attributes);

      if (success) {
        // Clean up storage since we completed without interruption
        sessionStorage.removeItem(STORAGE_KEY);
        window.location.href = '/checkout';
      } else {
        // executeReorder already restored the cart and alerted the user
        sessionStorage.removeItem(STORAGE_KEY);
        setLoadingState(trigger, false);
      }

    } catch (error) {
      console.error('[Cart Reorder] Unexpected error:', error);
      sessionStorage.removeItem(STORAGE_KEY);
      // Safest fallback — go to checkout anyway, order may be unordered but cart is intact
      window.location.href = '/checkout';
    }
  }

  // ─── Shared reorder execution (used by both intercept and resume) ───
  async function executeReorder(items, note, attributes) {
    try {
      // Clear cart
      const clearRes = await fetch('/cart/clear.js', { method: 'POST' });
      if (!clearRes.ok) throw new Error('Clear failed');

      // Re-add one by one — if one fails we know exactly which one
      for (const item of items) {
        const addRes = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [item] }),
        });

        if (!addRes.ok) {
          const errText = await addRes.text();
          console.error('[Cart Reorder] Failed on item:', item, errText);
          // Restore original cart from the items we already have
          await restoreCart(items, note, attributes);
          alert('Your cart could not be reordered. It has been restored — please try checking out again.');
          return false;
        }
      }

      // Restore note + attributes (wiped by clear)
      const updatePayload = {};
      if (note?.trim()) updatePayload.note = note;
      if (attributes) {
        const clean = Object.fromEntries(
          Object.entries(attributes).filter(([, v]) => v !== '')
        );
        if (Object.keys(clean).length > 0) updatePayload.attributes = clean;
      }
      if (Object.keys(updatePayload).length > 0) {
        await fetch('/cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload),
        });
      }

      console.log('[Cart Reorder] Reorder complete');
      return true;

    } catch (err) {
      console.error('[Cart Reorder] executeReorder error:', err);
      return false;
    }
  }

  // ─── Restore cart from a known items list ───
  async function restoreCart(items, note, attributes) {
    try {
      await fetch('/cart/clear.js', { method: 'POST' });
      for (const item of items) {
        await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [item] }),
        });
      }
      const updatePayload = {};
      if (note?.trim()) updatePayload.note = note;
      if (attributes) {
        const clean = Object.fromEntries(Object.entries(attributes).filter(([, v]) => v !== ''));
        if (Object.keys(clean).length > 0) updatePayload.attributes = clean;
      }
      if (Object.keys(updatePayload).length > 0) {
        await fetch('/cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload),
        });
      }
    } catch (err) {
      console.error('[Cart Reorder] Restore failed:', err);
    }
  }
  // ─── Loading state helper ───
  function setLoadingState(trigger, isLoading) {
    if (!trigger) return;
    if (isLoading) {
      trigger.setAttribute('disabled', 'disabled');
      trigger.setAttribute('aria-busy', 'true');
      trigger.dataset.originalText = trigger.textContent || trigger.value || '';
      if (trigger.tagName === 'BUTTON') trigger.textContent = 'Processing...';
      else if (trigger.tagName === 'INPUT') trigger.value = 'Processing...';
    } else {
      trigger.removeAttribute('disabled');
      trigger.removeAttribute('aria-busy');
      if (trigger.dataset.originalText) {
        if (trigger.tagName === 'BUTTON') trigger.textContent = trigger.dataset.originalText;
        else if (trigger.tagName === 'INPUT') trigger.value = trigger.dataset.originalText;
      }
    }
  }

  // ─── Button listener attachment ───
  function attachCheckoutListeners() {
    const selectors = [
      'button[name="checkout"]',
      'input[name="checkout"]',
      'a[href="/checkout"]',
    ];
    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        if (!el.dataset.reorderAttached) {
          el.addEventListener('click', reorderCartAndCheckout);
          el.dataset.reorderAttached = 'true';
        }
      });
    });
    document.querySelectorAll('form[action="/checkout"]').forEach(form => {
      if (!form.dataset.reorderAttached) {
        form.addEventListener('submit', reorderCartAndCheckout);
        form.dataset.reorderAttached = 'true';
      }
    });
  }

  // ─── Init ───
  document.addEventListener('DOMContentLoaded', () => {
    resumePendingReorder(); // Check for interrupted reorder first
    attachCheckoutListeners();
  });

  document.addEventListener('cart:updated', attachCheckoutListeners);
  document.addEventListener('cart:refresh', attachCheckoutListeners);

  const observer = new MutationObserver(attachCheckoutListeners);
  observer.observe(document.body, { childList: true, subtree: true });

})();