import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import { Rating } from '../Rating';

describe('Rating', () => {
  it('calls onChange when star clicked', () => {
    const fn = vi.fn();
    const { getAllByRole } = render(<Rating onChange={fn} />);
    const stars = getAllByRole('radio');
    const third = stars[2]!;
    fireEvent.click(third);
    expect(fn).toHaveBeenCalledWith(3);
  });
});
