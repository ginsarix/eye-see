import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('renders its children and handles clicks', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a spinner and is disabled while loading', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} loading>
        Save
      </Button>,
    );

    const button = screen.getByRole('button', { name: /save/i });
    expect(button).toBeDisabled();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('respects the disabled prop', () => {
    render(<Button disabled>Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
