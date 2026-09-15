import { prisma } from "./prisma";
import { decryptField } from "./encryption";

export async function dispatchWebhook(eventType: string, payload: any, projectId?: string, orgId?: string) {
  try {
    const where: any = {
      isActive: true,
      OR: []
    };
    
    if (projectId) {
      where.OR.push({ projectId });
    }
    if (orgId) {
      where.OR.push({ orgId, projectId: null });
    }
    
    if (where.OR.length === 0) return;

    const webhooks = await prisma.webhook.findMany({ where });

    webhooks.forEach((webhook) => {
      try {
        let events = [];
        try {
          events = JSON.parse(webhook.events);
        } catch {
          events = webhook.events.split(',').map((e: string) => e.trim());
        }

        if (events.includes(eventType)) {
          fetch(webhook.targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Webhook-Secret': decryptField(webhook.secret)
            },
            body: JSON.stringify({
              event: eventType,
              timestamp: new Date().toISOString(),
              data: payload
            })
          }).catch(err => {
            console.error(`Failed to dispatch webhook ${webhook.id}:`, err);
          });
        }
      } catch (err) {
        console.error(`Error processing webhook ${webhook.id}:`, err);
      }
    });
  } catch (error) {
    console.error("Failed to process webhooks:", error);
  }
}
