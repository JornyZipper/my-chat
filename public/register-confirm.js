/* Optional browser registration improvement.
 * Add <script src="/register-confirm.js" defer></script> after the existing frontend scripts.
 * This script supports registration represented by a real HTML <form>.
 * If your website uses a button outside a form, attach the validator inside app.js instead.
 */
(() => {
  'use strict';
  function improveRegistration() {
    const form = document.querySelector('#registerForm, #register-form, form[data-auth="register"], form[action*="register"]');
    if (!form || form.dataset.confirmInstalled) return;
    const passwords = [...form.querySelectorAll('input[type="password"]')];
    const password = passwords.find(el => /pass/i.test(`${el.id} ${el.name}`) && !/confirm|repeat|claim/i.test(`${el.id} ${el.name}`)) || passwords[0];
    if (!password) return;
    let confirm = passwords.find(el => /confirm|repeat/i.test(`${el.id} ${el.name}`));
    if (!confirm) {
      const label = document.createElement('label');
      label.htmlFor = 'browser-register-confirm-password';
      label.textContent = 'Повторите пароль';
      label.className = password.closest('.field')?.querySelector('label')?.className || 'field-label';
      confirm = document.createElement('input');
      confirm.type = 'password';
      confirm.id = 'browser-register-confirm-password';
      confirm.name = 'passwordConfirm';
      confirm.placeholder = 'Повторите пароль';
      confirm.autocomplete = 'new-password';
      confirm.required = true;
      confirm.minLength = 8;
      confirm.className = password.className || '';
      const wrapper = document.createElement('div');
      wrapper.className = 'register-confirm-wrapper';
      wrapper.append(label,confirm);
      const field = password.closest('.field, .form-group, .input-group') || password;
      field.insertAdjacentElement('afterend',wrapper);
    }
    form.dataset.confirmInstalled = 'true';
    const check = () => {
      if (password.value !== confirm.value) {
        confirm.setCustomValidity('Пароли не совпадают');
        return false;
      }
      confirm.setCustomValidity('');
      return true;
    };
    password.addEventListener('input',check);
    confirm.addEventListener('input',check);
    form.addEventListener('submit',(event) => {
      if (!check()) { event.preventDefault(); event.stopImmediatePropagation(); confirm.reportValidity(); }
    },true);
  }
  document.addEventListener('DOMContentLoaded', () => {
    improveRegistration();
    const observer = new MutationObserver(improveRegistration);
    observer.observe(document.body,{childList:true,subtree:true});
  });
})();
