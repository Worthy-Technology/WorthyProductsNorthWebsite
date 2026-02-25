class SearchForm extends HTMLElement {
  constructor() {
    super();
    this.input = this.querySelector('input[type="search"]');
    this.resetButton = this.querySelector('button[type="reset"]');

    if (this.input) {
      this.input.form.addEventListener('reset', this.onFormReset.bind(this));

      if ((this.input.dataset.secondPlaceholder || this.input.dataset.thirdPlaceholder || this.input.dataset.fourthPlaceholder)
        && (this.input.dataset.animatedPlaceholderMob === 'true' || !window.matchMedia('(max-width: 749.98px)').matches)) {
        this.typewriter();
      }
    }
  }

  shouldResetForm() {
    return !document.querySelector('[aria-selected="true"] a');
  }

  onFormReset(event) {
    // Prevent default so the form reset doesn't set the value gotten from the url on page load
    event?.preventDefault();
    // Don't reset if the user has selected an element on the predictive search dropdown
    if (this.shouldResetForm()) {
      this.input.value = '';
      this.input.focus();
    }
  }

  /**
   * Cycles through placeholder strings, simulating typing and deleting.
   */
  async typewriter() {
    const typingSpeed = 40;

    // Collect available placeholder strings
    const placeholders = [
      this.input.placeholder,
      this.input.dataset.secondPlaceholder,
      this.input.dataset.thirdPlaceholder,
      this.input.dataset.fourthPlaceholder,
    ].filter(Boolean);

    if (placeholders.length === 0) return;

    // Small delay helper
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const typeText = async (target) => {
      let current = this.input.getAttribute('placeholder') || '';
      // Avoid retyping overlapping prefix
      let remaining = (current.length >= 3 && target.startsWith(current))
        ? target.slice(current.length)
        : target;

      for (const char of remaining) {
        current += char;
        this.input.setAttribute('placeholder', current);
        await wait(typingSpeed);
      }
    };

    const deleteText = async (nextTarget) => {
      let current = this.input.getAttribute('placeholder') || '';

      while (
        current.length > 0 &&
        !(current.length >= 3 && nextTarget.startsWith(current))
        ) {
        current = current.slice(0, -1);
        this.input.setAttribute('placeholder', current);
        await wait(typingSpeed * 0.75);
      }
    };

    // Initial delay before first delete
    await wait(2000);

    let index = 0;
    while (true) {
      const next = placeholders[index = (index + 1) % placeholders.length];
      await deleteText(next);
      await wait(400); // Delay after delete
      await typeText(next);
      await wait(3000); // Delay after type in
    }
  }
}

customElements.define('search-form', SearchForm);
