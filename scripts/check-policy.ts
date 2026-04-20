import { prisma } from "@/lib/prisma";

async function main() {
  const policies = await prisma.accessPolicy.findMany({
    select: {
      id: true,
      name: true,
      targetType: true,
      targetValue: true,
      allowedDomains: true,
      allowedIpRanges: true,
      linkTtlSeconds: true,
      maxDownloads: true,
      requireAuth: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  console.log("ALL POLICIES:");
  console.log(JSON.stringify(policies, null, 2));

  const links = await prisma.generatedLink.findMany({
    select: {
      id: true,
      presignedUrlHash: true,
      documentId: true,
      policyId: true,
      expiresAt: true,
      downloadCount: true,
      maxDownloads: true,
      isRevoked: true,
      createdAt: true,
      document: {
        select: { filename: true, s3Key: true, isDeleted: true, bucket: { select: { name: true } } },
      },
      policy: { select: { name: true, allowedDomains: true, allowedIpRanges: true, requireAuth: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  console.log("\nRECENT LINKS:");
  console.log(JSON.stringify(links, null, 2));

  const recentAudits = await prisma.auditLog.findMany({
    where: { action: { in: ["LINK_ACCESS", "LINK_DENIED"] } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { action: true, targetId: true, metadata: true, ipAddress: true, userAgent: true, createdAt: true },
  });
  console.log("\nRECENT LINK AUDITS:");
  console.log(JSON.stringify(recentAudits, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
