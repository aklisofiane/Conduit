// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from './HomePage';

vi.mock('../api/hooks.js', () => ({
  useWorkflows: vi.fn(() => ({
    data: [
      {
        id: 'wf-1',
        name: 'Deploy',
        description: null,
        definition: {},
        isActive: true,
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
        runs: [
          { id: 'r-1', status: 'RUNNING', startedAt: '2025-01-01', finishedAt: null, error: null },
        ],
        _count: { runs: 10 },
      },
      {
        id: 'wf-2',
        name: 'Lint',
        description: null,
        definition: {},
        isActive: false,
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
        runs: [
          { id: 'r-2', status: 'FAILED', startedAt: '2025-01-01', finishedAt: '2025-01-01', error: 'oops' },
        ],
        _count: { runs: 3 },
      },
    ],
    isLoading: false,
  })),
  useCreateWorkflow: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}));

vi.mock('../components/workflow-list/WorkflowRowItem.js', () => ({
  WorkflowRowItem: () => <div data-testid="workflow-row" />,
}));

vi.mock('../components/templates/TemplatePickerDialog.js', () => ({
  TemplatePickerDialog: () => null,
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

describe('HomePage', () => {
  it('renders the "Total runs" stat card with the correct sum', () => {
    renderPage();
    expect(screen.getByText('Total runs')).toBeTruthy();
    expect(screen.getByText('across all workflows')).toBeTruthy();
    // 10 + 3 = 13
    expect(screen.getByText('13')).toBeTruthy();
  });

  it('renders 5 stat cards', () => {
    const { container } = renderPage();
    const gridSection = container.querySelector('.grid');
    expect(gridSection).toBeTruthy();
    expect(gridSection!.children).toHaveLength(5);
  });
});
