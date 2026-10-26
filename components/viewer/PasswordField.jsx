'use client';
// components/viewer/PasswordField.jsx — one password input for every screen
// that asks for one, with the show/hide eye inside the field.
//
// Why one component: a password box that behaves differently on the login
// sheet and the sign-up sheet is how a person ends up locked out of their
// own account on a phone keyboard. The eye is a real button (44px, the
// touch-target rule), it says what it does to a screen reader, and it never
// autofills from the wrong field: the caller passes `autoComplete`
// ('current-password' when logging in, 'new-password' when choosing one).
//
// Design: the field styles come from .v-field in app/viewer.css; the eye
// sits inside the box on the right, ink on the field's own tint.
import { useId, useState } from 'react';
import { Eye, EyeOff } from './Icons';

export default function PasswordField({
  label = 'Password',
  value,
  onChange,
  autoComplete = 'current-password',
  placeholder,
  error,
  hint,
  name = 'password',
  required = false,
  autoFocus = false,
  testId = 'password-field',
}) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return (
    <label className="v-field" htmlFor={id}>
      {label}
      <span style={{ position: 'relative', display: 'block' }}>
        <input
          id={id}
          name={name}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          required={required}
          autoFocus={autoFocus}
          onChange={onChange}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={hint || error ? `${id}-note` : undefined}
          style={{ paddingRight: 52 }}
          data-testid={testId}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-pressed={shown}
          aria-label={shown ? 'Hide password' : 'Show password'}
          title={shown ? 'Hide password' : 'Show password'}
          data-testid={`${testId}-toggle`}
          style={{
            position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)',
            width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', background: 'transparent', color: 'var(--ink)', cursor: 'pointer', borderRadius: 12, padding: 0,
          }}
        >
          {shown ? <EyeOff size={20} /> : <Eye size={20} />}
        </button>
      </span>
      {(error || hint) && <span id={`${id}-note`} className={error ? 'v-err' : 'v-muted'} style={{ fontWeight: 400, fontSize: 14 }}>{error || hint}</span>}
    </label>
  );
}
