/**
 * Cart Checkout Reorder
 * Intercepts the checkout button, reverses cart line items to match
 * first-added-first order (matching customer PO sequence), then redirects.
 * Preserves: line item properties, selling plans, cart note, cart attributes.
 */

(function () {
  'use strict';

  async function reorderCartAndCheckout(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const trigger = event.currentTarget;

    // Show a loading state so the customer knows something is happening
    setLoadingState(trigger, true);

    try {
      // Step 1: Fetch full cart data from backend (not DOM)
      // This ensures we capture ALL data: properties, selling plans, etc.
      const cartRes = await fetch('/cart.json');
      if (!cartRes.ok) throw new Error('Failed to fetch cart');
      const cart = await cartRes.json();

      // If cart is empty or has only one item, no reorder needed — go straight to checkout
      if (!cart.items || cart.items.length <= 1) {
        window.location.href = '/checkout';
        return;
      }

      // Step 2: Shopify adds newest items at index 0.
      // Reversing the array gives us first-added-first (matching PO order).
      const itemsInCorrectOrder = [...cart.items].reverse();

      // Step 3: Build the items payload, preserving ALL line item data
      const itemsPayload = itemsInCorrectOrder.map((item) => {
        const entry = {
          id: item.variant_id,
          quantity: item.quantity,
        };

        // Preserve line item properties (custom fields, special instructions)
        if (item.properties && Object.keys(item.properties).length > 0) {
          entry.properties = item.properties;
        }

        // Preserve selling plan (subscription products)
        if (item.selling_plan_allocation?.selling_plan?.id) {
          entry.selling_plan = item.selling_plan_allocation.selling_plan.id;
        }

        return entry;
      });

      // Step 4: Clear the cart
      const clearRes = await fetch('/cart/clear.js', { method: 'POST' });
      if (!clearRes.ok) throw new Error('Failed to clear cart');

      // Step 5: Re-add all items in one API call (Shopify processes array sequentially)
      // First item in array → index 0 in new cart → appears first in checkout/invoice
      const addRes = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: itemsPayload }),
      });
      if (!addRes.ok) throw new Error('Failed to re-add items to cart');

      // Step 6: Restore cart note and attributes (both are wiped by /cart/clear.js)
      const updatePayload = {};

      if (cart.note && cart.note.trim() !== '') {
        updatePayload.note = cart.note;
      }

      if (cart.attributes && Object.keys(cart.attributes).length > 0) {
        // Filter out empty attribute values to keep cart clean
        const cleanAttributes = Object.fromEntries(
          Object.entries(cart.attributes).filter(([, v]) => v !== '')
        );
        if (Object.keys(cleanAttributes).length > 0) {
          updatePayload.attributes = cleanAttributes;
        }
      }

      if (Object.keys(updatePayload).length > 0) {
        const updateRes = await fetch('/cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload),
        });
        if (!updateRes.ok) throw new Error('Failed to restore cart metadata');
      }

      // Step 7: All good — proceed to checkout
      window.location.href = '/checkout';

    } catch (error) {
      console.error('[Cart Reorder] Error during reorder:', error);

      // IMPORTANT: On any failure, we do NOT silently redirect.
      // The cart has been cleared at this point so we need to recover gracefully.
      // Check if the cart still has items (re-add may have partially succeeded).
      try {
        const recoveryCheck = await fetch('/cart.json');
        const recoveryCart = await recoveryCheck.json();

        if (recoveryCart.items && recoveryCart.items.length > 0) {
          // Partial success — items are there, just proceed to checkout
          // Order may not be in PO sequence but at least nothing is lost
          console.warn('[Cart Reorder] Proceeding to checkout with potentially unordered cart');
          window.location.href = '/checkout';
        } else {
          // Cart is genuinely empty — do not redirect, alert the customer
          setLoadingState(trigger, false);
          alert(
            'There was an issue processing your cart. Please refresh the page and try again. ' +
            'Your session is still active — please add your items again.'
          );
        }
      } catch {
        // Recovery check also failed — failsafe redirect
        window.location.href = '/checkout';
      }
    }
  }

  function setLoadingState(trigger, isLoading) {
    if (!trigger) return;
    if (isLoading) {
      trigger.setAttribute('disabled', 'disabled');
      trigger.setAttribute('aria-busy', 'true');
      // Store original text for restoration if needed
      if (trigger.tagName === 'BUTTON' || trigger.tagName === 'INPUT') {
        trigger.dataset.originalText = trigger.textContent || trigger.value;
        if (trigger.tagName === 'BUTTON') trigger.textContent = 'Processing...';
        else trigger.value = 'Processing...';
      }
    } else {
      trigger.removeAttribute('disabled');
      trigger.removeAttribute('aria-busy');
      if (trigger.dataset.originalText) {
        if (trigger.tagName === 'BUTTON') trigger.textContent = trigger.dataset.originalText;
        else trigger.value = trigger.dataset.originalText;
      }
    }
  }

  function attachCheckoutListeners() {
    // Covers all common checkout button/form patterns in Shopify themes
    // 1. Buttons with name="checkout" (most common in cart forms)
    // 2. Buttons/links pointing to /checkout
    // 3. Forms with action="/checkout"
    const checkoutSelectors = [
      'button[name="checkout"]',
      'input[name="checkout"]',
      'a[href="/checkout"]',
    ];

    checkoutSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        // Avoid attaching multiple listeners if this function is called again
        if (!el.dataset.reorderAttached) {
          el.addEventListener('click', reorderCartAndCheckout);
          el.dataset.reorderAttached = 'true';
        }
      });
    });

    // Also intercept form submissions for cart forms
    document.querySelectorAll('form[action="/checkout"]').forEach((form) => {
      if (!form.dataset.reorderAttached) {
        form.addEventListener('submit', reorderCartAndCheckout);
        form.dataset.reorderAttached = 'true';
      }
    });
  }

  // Attach on initial load
  document.addEventListener('DOMContentLoaded', attachCheckoutListeners);

  // Re-attach after cart drawer / dynamic cart sections re-render
  // Ignite and most Shopify themes dispatch this event after AJAX cart updates
  document.addEventListener('cart:updated', attachCheckoutListeners);
  document.addEventListener('cart:refresh', attachCheckoutListeners);

  // For themes using custom elements that re-render cart HTML
  const observer = new MutationObserver(() => {
    attachCheckoutListeners();
  });
  observer.observe(document.body, { childList: true, subtree: true });

})();