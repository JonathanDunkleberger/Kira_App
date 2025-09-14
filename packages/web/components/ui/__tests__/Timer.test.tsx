import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { Timer } from '../Timer';

describe('Timer', () => {
  it('starts at 00:00', () => {
    const { getByLabelText } = render(<Timer />);
    expect(getByLabelText('Elapsed time').textContent).toBe('00:00');
  });
});
