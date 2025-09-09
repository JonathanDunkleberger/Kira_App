import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Button } from '../Button';

describe('Button', () => {
  it('renders primary variant by default', () => {
    const { getByRole } = render(<Button>Click</Button>);
    const btn = getByRole('button');
    expect(btn.className).toMatch(/bg-pistachio-500/);
  });
});
