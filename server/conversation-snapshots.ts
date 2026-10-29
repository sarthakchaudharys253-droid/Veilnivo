import {Prisma,type PrismaClient,type Message} from '@prisma/client';

const SNAPSHOT_BATCH_SIZE=500;

/** Candidates come from the caller's accepted contacts, never a public directory. */
export async function latestConversationMessages(database:PrismaClient,userId:string,peerIds:string[]):Promise<Map<string,Message>> {
 const peers=[...new Set(peerIds)].filter(peerId=>peerId!==userId),latest=new Map<string,Message>();
 for(let offset=0;offset<peers.length;offset+=SNAPSHOT_BATCH_SIZE){
  const batch=peers.slice(offset,offset+SNAPSHOT_BATCH_SIZE);
  // One indexed latest-row lookup per peer, in one bounded database round trip.
  // The lateral limit avoids sorting/materializing every historical message.
  const rows=await database.$queryRaw<Message[]>(Prisma.sql`
   SELECT latest.* FROM (VALUES ${Prisma.join(batch.map(peerId=>Prisma.sql`(${peerId}::text)`))}) AS peer("id")
   CROSS JOIN LATERAL (
    SELECT candidate.* FROM (
     (SELECT message.* FROM "Message" AS message
      WHERE message."senderId"=${userId} AND message."recipientId"=peer."id"
        AND (message."expiresAt" IS NULL OR message."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC'))
      ORDER BY message."createdAt" DESC,message."id" DESC LIMIT 1)
     UNION ALL
     (SELECT message.* FROM "Message" AS message
      WHERE message."recipientId"=${userId} AND message."senderId"=peer."id"
        AND (message."expiresAt" IS NULL OR message."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC'))
      ORDER BY message."createdAt" DESC,message."id" DESC LIMIT 1)
    ) AS candidate ORDER BY candidate."createdAt" DESC,candidate."id" DESC LIMIT 1
   ) AS latest
  `);
  for(const row of rows)latest.set(row.senderId===userId?row.recipientId:row.senderId,row);
 }
 return latest;
}
