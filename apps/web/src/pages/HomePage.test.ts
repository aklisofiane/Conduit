// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

vi.mock('../api/hooks.js', () => ({
  useWorkflows: () => ({ data: [], isLoading: false }),
  useCreateWorkflow: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../components/templates/TemplatePickerDialog.js', () => ({
  TemplatePickerDialog: () => null,
}));

vi.mock('../components/workflow-list/WorkflowRowItem.js', () => ({
  WorkflowRowItem: () => null,
}));

afterEach(cleanup);

describe('HomePage', () => {
  it('renders the heading with correct text', async () => {
    const { HomePage } = await import('./HomePage.js');
    render(createElement(HomePage));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Workflow state');
  });
});
