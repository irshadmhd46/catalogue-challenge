import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

export function SearchBox() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [invalid, setInvalid] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = term.trim();
    if (trimmed === '') {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void navigate(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <form className="search" role="search" onSubmit={submit}>
      <label htmlFor="search-term" className="visually-hidden">
        Search products
      </label>
      <input
        id="search-term"
        type="search"
        value={term}
        maxLength={100}
        aria-invalid={invalid}
        aria-describedby={invalid ? 'search-error' : undefined}
        placeholder="Search products"
        onChange={(event) => {
          setTerm(event.target.value);
        }}
      />
      <button type="submit">Search</button>
      {invalid && (
        <span id="search-error" role="alert" className="field-error">
          Enter something to search for.
        </span>
      )}
    </form>
  );
}
