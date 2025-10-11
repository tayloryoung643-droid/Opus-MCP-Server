import { getTokensFor, clearTokenCache } from '../../src/tokenProvider.js';

const SALESFORCE_API_VERSION = 'v57.0';

function log(rid, message, extra = {}) {
  const payload = { rid, source: 'SalesforceService', ...extra };
  console.log(`[Salesforce] ${message}`, payload);
}

function buildUrl(instanceUrl, path, query) {
  const url = new URL(path, instanceUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url;
}

function escapeSoql(value) {
  return String(value).replace(/'/g, "\\'");
}

function escapeSosl(value) {
  return String(value).replace(/[\\{}]/g, '\\$&').replace(/"/g, '\\"').replace(/'/g, "\\'");
}

async function fetchSalesforce(userId, requestId, path, { query, method = 'GET' } = {}, attempt = 1) {
  const rid = requestId ?? `sfdc-${attempt}`;
  const tokens = await getTokensFor(userId, rid);

  if (!tokens?.salesforce?.accessToken || !tokens.salesforce.instanceUrl) {
    log(rid, 'No Salesforce tokens available', { userId });
    return null;
  }

  const url = buildUrl(tokens.salesforce.instanceUrl, path, query);
  const headers = {
    'Authorization': `Bearer ${tokens.salesforce.accessToken}`,
    'Accept': 'application/json'
  };

  if (requestId) {
    headers['x-request-id'] = requestId;
  }

  const response = await fetch(url, { method, headers });

  if (response.status === 401 || response.status === 403) {
    log(rid, 'Received unauthorized response, clearing cache and retrying', {
      userId,
      status: response.status,
      attempt
    });

    if (attempt === 1) {
      clearTokenCache(userId);
      return fetchSalesforce(userId, requestId, path, { query, method }, attempt + 1);
    }
  }

  if (!response.ok) {
    const errorBody = await safeReadJson(response);
    log(rid, 'Salesforce API error response', {
      userId,
      status: response.status,
      error: errorBody
    });
    throw new Error(`Salesforce API request failed with status ${response.status}`);
  }

  return await response.json();
}

async function safeReadJson(response) {
  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

const DEFAULT_ACCOUNT_FIELDS = [
  'Id',
  'Name',
  'Industry',
  'NumberOfEmployees',
  'AnnualRevenue',
  'Website',
  'Description'
];

const DEFAULT_OPPORTUNITY_FIELDS = [
  'Id',
  'Name',
  'StageName',
  'Amount',
  'CloseDate',
  'AccountId',
  'Account.Name'
];

export const salesforceCrmService = {
  async getAccountById(userId, accountId, requestId, fields = DEFAULT_ACCOUNT_FIELDS) {
    const data = await fetchSalesforce(
      userId,
      requestId,
      `/services/data/${SALESFORCE_API_VERSION}/sobjects/Account/${encodeURIComponent(accountId)}`
    );

    if (!data) {
      return null;
    }

    const filtered = filterFields(data, fields);
    log(requestId ?? 'sfdc-account', 'Fetched account by ID', { userId, accountId });
    return filtered;
  },

  async searchRecords(userId, queryText, objectTypes = ['Account'], requestId) {
    const rid = requestId ?? 'sfdc-search';
    const trimmed = queryText?.trim();

    if (!trimmed) {
      const defaultQuery = `SELECT Id, Name, Industry, NumberOfEmployees, AnnualRevenue, Website, Description FROM Account ORDER BY LastModifiedDate DESC NULLS LAST LIMIT 10`;
      const data = await fetchSalesforce(
        userId,
        requestId,
        `/services/data/${SALESFORCE_API_VERSION}/query/`,
        { query: { q: defaultQuery } }
      );
      return data?.records ?? [];
    }

    const returningClause = objectTypes
      .map(type => `${type}(Id, Name, Industry, NumberOfEmployees, AnnualRevenue, Website, Description LIMIT 10)`)
      .join(', ');

    const searchQuery = `FIND {${escapeSosl(trimmed)}} IN ALL FIELDS RETURNING ${returningClause}`;
    log(rid, 'Executing SOSL search', { userId, objectTypes, query: trimmed });

    const data = await fetchSalesforce(
      userId,
      requestId,
      `/services/data/${SALESFORCE_API_VERSION}/search/`,
      { query: { q: searchQuery } }
    );

    if (!data) {
      return [];
    }

    if (Array.isArray(data.searchRecords)) {
      return data.searchRecords;
    }

    return Array.isArray(data) ? data : [];
  },

  async searchAccounts(userId, options = {}, requestId) {
    const { queryText, limit = 10, fields = DEFAULT_ACCOUNT_FIELDS } = options;
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 200);

    if (!queryText || !queryText.trim()) {
      const query = `SELECT ${fields.join(', ')} FROM Account ORDER BY LastModifiedDate DESC NULLS LAST LIMIT ${safeLimit}`;
      const data = await fetchSalesforce(
        userId,
        requestId,
        `/services/data/${SALESFORCE_API_VERSION}/query/`,
        { query: { q: query } }
      );
      const records = Array.isArray(data?.records) ? data.records : [];
      return records.map(record => filterFields(record, fields));
    }

    const returningClause = `Account(${fields.join(', ')} LIMIT ${safeLimit})`;
    const searchQuery = `FIND {${escapeSosl(queryText.trim())}} IN ALL FIELDS RETURNING ${returningClause}`;

    const data = await fetchSalesforce(
      userId,
      requestId,
      `/services/data/${SALESFORCE_API_VERSION}/search/`,
      { query: { q: searchQuery } }
    );

    if (Array.isArray(data?.searchRecords)) {
      return data.searchRecords
        .filter(record => record?.attributes?.type === 'Account')
        .map(record => filterFields(record, fields));
    }

    if (Array.isArray(data)) {
      return data
        .filter(record => record?.attributes?.type === 'Account')
        .map(record => filterFields(record, fields));
    }

    return [];
  },

  async getOpportunityById(userId, opportunityId, requestId, fields = DEFAULT_OPPORTUNITY_FIELDS) {
    const data = await fetchSalesforce(
      userId,
      requestId,
      `/services/data/${SALESFORCE_API_VERSION}/sobjects/Opportunity/${encodeURIComponent(opportunityId)}`
    );

    if (!data) {
      return null;
    }

    const filtered = filterFields(data, fields);
    log(requestId ?? 'sfdc-opportunity', 'Fetched opportunity by ID', { userId, opportunityId });
    return filtered;
  },

  async getOpportunities(userId, options = {}, requestId) {
    const { limit = 10, accountId, contactId, fields = DEFAULT_OPPORTUNITY_FIELDS } = options;
    const conditions = [];

    if (accountId) {
      conditions.push(`AccountId = '${escapeSoql(accountId)}'`);
    }

    if (contactId) {
      conditions.push(`Id IN (SELECT OpportunityId FROM OpportunityContactRole WHERE ContactId = '${escapeSoql(contactId)}')`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 200);
    const query = `SELECT ${fields.join(', ')} FROM Opportunity ${whereClause} ORDER BY CloseDate DESC NULLS LAST LIMIT ${safeLimit}`;

    log(requestId ?? 'sfdc-opps', 'Querying opportunities', {
      userId,
      accountId,
      contactId,
      limit: safeLimit
    });

    const data = await fetchSalesforce(
      userId,
      requestId,
      `/services/data/${SALESFORCE_API_VERSION}/query/`,
      { query: { q: query } }
    );

    if (!data) {
      return [];
    }

    if (!Array.isArray(data.records)) {
      return [];
    }

    return data.records.map(record => filterFields(record, fields));
  }
};

function filterFields(record, fields) {
  if (!fields || fields.length === 0) {
    return record;
  }

  const result = {};
  for (const field of fields) {
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      if (record[parent] && typeof record[parent] === 'object') {
        result[parent] = {
          ...(result[parent] || {}),
          [child]: record[parent][child]
        };
      }
    } else if (field in record) {
      result[field] = record[field];
    }
  }
  if (record.Id && !result.Id) {
    result.Id = record.Id;
  }
  return result;
}

export default salesforceCrmService;
