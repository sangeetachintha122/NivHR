import { api } from './client.js';

export async function getAllEmployees(params = {}) {
  const first = await api.get('/employees', { params: { ...params, page: 1, limit: 100 } });
  const employees = [...first.data.employees];
  const pages = first.data.pagination?.totalPages || 1;
  for (let page = 2; page <= pages; page += 1) {
    const { data } = await api.get('/employees', { params: { ...params, page, limit: 100 } });
    employees.push(...data.employees);
  }
  return { employees, pagination: first.data.pagination };
}

export async function getAllLeaves(params = {}) {
  const first = await api.get('/leaves', { params: { ...params, page: 1, limit: 100 } });
  const leaves = [...first.data.leaves];
  const pages = first.data.pagination?.totalPages || 1;
  for (let page = 2; page <= pages; page += 1) {
    const { data } = await api.get('/leaves', { params: { ...params, page, limit: 100 } });
    leaves.push(...data.leaves);
  }
  return leaves;
}

export async function getAllMyLeaves(params = {}) {
  const first = await api.get('/leaves/mine', { params: { ...params, page: 1, limit: 100 } });
  const leaves = [...first.data.leaves];
  const pages = first.data.pagination?.totalPages || 1;
  for (let page = 2; page <= pages; page += 1) {
    const { data } = await api.get('/leaves/mine', { params: { ...params, page, limit: 100 } });
    leaves.push(...data.leaves);
  }
  return { ...first.data, leaves };
}

export async function askAnalytics(question) {
  const { data } = await api.post('/analytics/ask', { question });
  return data;
}
