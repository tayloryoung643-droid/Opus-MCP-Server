import { neon } from '@neondatabase/serverless';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

const sql = neon(connectionString);

export const storage = {
  // Company queries
  async getCompaniesByContactEmail(email) {
    try {
      const result = await sql`
        SELECT DISTINCT c.* FROM companies c
        JOIN contacts ct ON ct.company_id = c.id
        WHERE ct.email = ${email}
      `;
      return result || [];
    } catch (error) {
      console.error('[Storage] getCompaniesByContactEmail error:', error);
      return [];
    }
  },

  async getCompaniesByName(name) {
    try {
      const result = await sql`
        SELECT * FROM companies
        WHERE name ILIKE ${'%' + name + '%'}
        LIMIT 10
      `;
      return result || [];
    } catch (error) {
      console.error('[Storage] getCompaniesByName error:', error);
      return [];
    }
  },

  async getCompanyByDomain(domain) {
    try {
      const result = await sql`
        SELECT * FROM companies
        WHERE domain = ${domain}
        LIMIT 1
      `;
      return result?.[0] || null;
    } catch (error) {
      console.error('[Storage] getCompanyByDomain error:', error);
      return null;
    }
  },

  async getCompany(companyId) {
    try {
      const result = await sql`
        SELECT * FROM companies
        WHERE id = ${companyId}
        LIMIT 1
      `;
      return result?.[0] || null;
    } catch (error) {
      console.error('[Storage] getCompany error:', error);
      return null;
    }
  },

  // Call queries
  async getCallsByCompanyIds(companyIds, sinceDate, limit = 10) {
    try {
      const result = await sql`
        SELECT * FROM calls
        WHERE company_id = ANY(${companyIds})
        AND scheduled_at >= ${sinceDate.toISOString()}
        ORDER BY scheduled_at DESC
        LIMIT ${limit}
      `;
      return result || [];
    } catch (error) {
      console.error('[Storage] getCallsByCompanyIds error:', error);
      return [];
    }
  },

  async getPreviousCalls() {
    try {
      const result = await sql`
        SELECT * FROM calls
        WHERE status IN ('completed', 'scheduled')
        ORDER BY scheduled_at DESC
        LIMIT 50
      `;
      return result || [];
    } catch (error) {
      console.error('[Storage] getPreviousCalls error:', error);
      return [];
    }
  },

  // Contact queries
  async getContactsByCompany(companyId) {
    try {
      const result = await sql`
        SELECT * FROM contacts
        WHERE company_id = ${companyId}
      `;
      return result || [];
    } catch (error) {
      console.error('[Storage] getContactsByCompany error:', error);
      return [];
    }
  },

  // Call prep queries
  async getCallPrep(callId) {
    try {
      const result = await sql`
        SELECT * FROM call_preps
        WHERE call_id = ${callId}
        LIMIT 1
      `;
      return result?.[0] || null;
    } catch (error) {
      console.error('[Storage] getCallPrep error:', error);
      return null;
    }
  },

  async getPrepNotes(callId) {
    try {
      const result = await sql`
        SELECT * FROM prep_notes
        WHERE event_id = ${callId}
        ORDER BY updated_at DESC
        LIMIT 1
      `;
      return result?.[0] || null;
    } catch (error) {
      console.error('[Storage] getPrepNotes error:', error);
      return null;
    }
  }
};
