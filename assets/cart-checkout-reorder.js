(function () {
  'use strict';

  const JOB_KEY = 'cart_reorder_job';

  // ── Overlay ──────────────────────────────────────────────────────────────
  function showOverlay() {
    if (document.getElementById('cr-overlay')) return;
    const el = document.createElement('div');
    el.id = 'cr-overlay';
    el.innerHTML = `
      <style>
        #cr-overlay {
          position: fixed; inset: 0; z-index: 99999;
          background: rgba(255,255,255,0.95);
          display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 14px;
        }
        #cr-spinner {
          width: 36px; height: 36px;
          border: 3px solid #e0e0e0; border-top-color: #222;
          border-radius: 50%;
          animation: cr-spin 0.75s linear infinite;
        }
        #cr-overlay p { margin: 0; font-size: 14px; color: #444; font-family: sans-serif; }
        @keyframes cr-spin { to { transform: rotate(360deg); } }
      </style>
      <div id="cr-spinner"></div>
      <p>Preparing your order…</p>
    `;
    document.body.appendChild(el);
  }

  // ── Core reorder logic ───────────────────────────────────────────────────
  async function executeReorder(payload, note, attributes) {
    // Clear cart
    const clearRes = await fetch('/cart/clear.js', { method: 'POST' });
    if (!clearRes.ok) throw new Error('clear failed: ' + clearRes.status);

    // Batch-add all items in one request (Shopify processes array in order)
    const addRes = await fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: payload }),
    });
    if (!addRes.ok) throw new Error('add failed: ' + await addRes.text());

    // Restore note + attributes (wiped by clear)
    const update = {};
    if (note?.trim()) update.note = note;
    if (attributes) {
      const clean = Object.fromEntries(
        Object.entries(attributes).filter(([, v]) => v !== '')
      );
      if (Object.keys(clean).length) update.attributes = clean;
    }
    if (Object.keys(update).length) {
      await fetch('/cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
    }
  }

  // ── Resume interrupted reorder on page load ──────────────────────────────
  async function resumeIfPending() {
    const raw = sessionStorage.getItem(JOB_KEY);
    if (!raw) return false;

    let job;
    try { job = JSON.parse(raw); } catch {
      sessionStorage.removeItem(JOB_KEY);
      return false;
    }

    showOverlay();

    try {
      const cart = await fetch('/cart.json').then(r => r.json());
      const expected = job.payload.length;
      const actual = cart.item_count ?? cart.items?.length ?? 0;
      const firstVariantId = cart.items?.[0]?.variant_id;

      if (actual === 0) {
        // Clear ran but add didn't — run the add
        console.log('[Cart Reorder] Resume: cart empty, running add');
        await executeReorder(job.payload, job.note, job.attributes);

      } else if (actual === expected && firstVariantId === job.payload[0]?.id) {
        // Items present and first item matches our intended order — reorder succeeded
        console.log('[Cart Reorder] Resume: reorder already complete');

      } else {
        // Items present but in original order — clear and redo
        console.log('[Cart Reorder] Resume: reordering again');
        await executeReorder(job.payload, job.note, job.attributes);
      }

      // Success — clear job and go to checkout
      sessionStorage.removeItem(JOB_KEY);
      window.location.href = '/checkout';
      return true;

    } catch (err) {
      console.error('[Cart Reorder] Resume error:', err);
      // Don't remove sessionStorage — let the next load try again
      // But don't loop forever: if we've retried too many times, give up
      job.retries = (job.retries || 0) + 1;
      if (job.retries >= 3) {
        console.warn('[Cart Reorder] Too many retries, giving up');
        sessionStorage.removeItem(JOB_KEY);
        window.location.href = '/checkout';
      } else {
        sessionStorage.setItem(JOB_KEY, JSON.stringify(job));
        window.location.reload();
      }
      return true;
    }
  }

  // ── Main checkout intercept ──────────────────────────────────────────────
  async function reorderCartAndCheckout(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    showOverlay();

    try {
      const cart = await fetch('/cart.json').then(r => r.json());

      if (!cart.items?.length || cart.items.length <= 1) {
        sessionStorage.removeItem(JOB_KEY);
        window.location.href = '/checkout';
        return;
      }

      // Reverse = first-added-first (Shopify stores newest at index 0)
      const payload = [...cart.items].reverse().map(item => {
        const entry = { id: item.variant_id, quantity: item.quantity };
        if (item.properties && Object.keys(item.properties).length > 0)
          entry.properties = item.properties;
        if (item.selling_plan_allocation?.selling_plan?.id)
          entry.selling_plan = item.selling_plan_allocation.selling_plan.id;
        return entry;
      });

      // Validate: all variant IDs must be present
      if (payload.some(i => !i.id)) {
        console.warn('[Cart Reorder] Missing variant IDs, skipping reorder');
        window.location.href = '/checkout';
        return;
      }

      // Save job BEFORE touching the cart
      // Kept in sessionStorage until we successfully reach /checkout
      const job = {
        payload,
        note: cart.note || '',
        attributes: cart.attributes || {},
        retries: 0,
      };
      sessionStorage.setItem(JOB_KEY, JSON.stringify(job));

      await executeReorder(payload, cart.note, cart.attributes);

      // Success
      sessionStorage.removeItem(JOB_KEY);
      window.location.href = '/checkout';

    } catch (err) {
      console.error('[Cart Reorder] Error:', err);
      // Job stays in sessionStorage — next page load will resume
      // (The theme's reload after clear triggers this automatically)
    }
  }

  // ── Listener attachment ──────────────────────────────────────────────────
  function attach() {
    ['button[name="checkout"]', 'input[name="checkout"]', 'a[href="/checkout"]']
      .forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          if (!el.dataset.reorderAttached) {
            el.addEventListener('click', reorderCartAndCheckout, true); // capture = fires first
            el.dataset.reorderAttached = 'true';
          }
        });
      });

    document.querySelectorAll('form[action="/checkout"]').forEach(form => {
      if (!form.dataset.reorderAttached) {
        form.addEventListener('submit', reorderCartAndCheckout, true);
        form.dataset.reorderAttached = 'true';
      }
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    const resumed = await resumeIfPending();
    if (!resumed) attach();
  });

  document.addEventListener('cart:updated', attach);
  document.addEventListener('cart:refresh', attach);
  new MutationObserver(attach).observe(document.body, { childList: true, subtree: true });

})();