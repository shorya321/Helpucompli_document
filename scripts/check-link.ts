import { prisma } from "@/lib/prisma";

async function main() {
  const TOKEN = "t0o3Klv3IMqrtHVLm79PAPq8uqlySd90oJAQENbVWao";
  const link = await prisma.generatedLink.findUnique({
    where: { presignedUrlHash: TOKEN },
    include: {
      document: {
        select: { id: true, filename: true, isDeleted: true, bucketId: true, s3Key: true },
      },
      policy: { select: { id: true, name: true, requireAuth: true } },
    },
  });
  console.log("LINK:", JSON.stringify(link, null, 2));
  if (link) {
    console.log("expiresAt:", link.expiresAt.toISOString());
    console.log("now:      ", new Date().toISOString());
    console.log("remainingSec:", Math.floor((link.expiresAt.getTime() - Date.now()) / 1000));
  }

  const audits = await prisma.auditLog.findMany({
    where: link ? { targetId: link.id } : { action: "LINK_DENIED" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { action: true, metadata: true, createdAt: true, ipAddress: true },
  });
  console.log("AUDITS:", JSON.stringify(audits, null, 2));

  // Check what policies might match this doc
  if (link?.document) {
    const bucket = await prisma.bucket.findUnique({
      where: { id: link.document.bucketId },
      select: { name: true },
    });
    console.log("BUCKET NAME:", bucket?.name);
    const matchingPolicies = await prisma.accessPolicy.findMany({
      where: {
        OR: [
          { targetType: "object", targetValue: link.document.s3Key },
          { targetType: "prefix" },
          { targetType: "bucket", targetValue: bucket?.name },
        ],
      },
    });
    console.log("CANDIDATE POLICIES:", JSON.stringify(matchingPolicies, null, 2));
    const allPolicies = await prisma.accessPolicy.findMany({
      select: { id: true, name: true, targetType: true, targetValue: true, requireAuth: true, allowedDomains: true, allowedIpRanges: true },
    });
    console.log("ALL POLICIES:", JSON.stringify(allPolicies, null, 2));
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
