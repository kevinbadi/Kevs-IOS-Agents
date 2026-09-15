/**
 * LinkedIn connection requests with no note. Use this after the monthly
 * invitation-note cap is hit. Confirms with Pending / Invitation sent.
 *
 *   IOS_UDID=… WDA_URL=http://127.0.0.1:8101 \
 *     LINKEDIN_LEADS_CSV=data/linkedin/leads/connect.csv \
 *     npm run linkedin:connect
 */

process.env.LINKEDIN_CONNECT_MODE = 'plain';

await import('./cold-connect.js');
