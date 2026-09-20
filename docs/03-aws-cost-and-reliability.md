# AWS Cost and Production Thinking

How I'd approach the first two weeks, asked to understand the existing AWS
setup, improve reliability and control unnecessary cost.

I don't have access to the account, so this is method rather than findings.

## 1. Observe before changing

The first week is mostly reading. A resource that looks idle might be a
failover, a nightly job, or something a cron hits monthly, and I wouldn't know
which without asking.

So in week one the only things I'd change are additive — tags, dashboards,
alarms. Nothing that affects running traffic.

## 2. What I'd inspect first

**Cost Explorer, grouped by service, last 6 months.** This single view tells you
where the money is and whether it's growing faster than the user base. Six
months rather than one, because a spike in March that never came down is more
interesting than last week's total.

**The same view grouped by tag.** If tagging is inconsistent — and it usually is
— that's finding number one. You can't attribute cost you can't group, and
everything after this is easier once it's fixed. Adding tags changes nothing
about how the system runs, so it's safe to do immediately.

**Trusted Advisor and Compute Optimizer.** Both run automatically and cost
nothing. Trusted Advisor checks the account against AWS best practices and flags
things like unattached volumes and over-permissive security groups. Compute
Optimizer compares instance sizes against actual CloudWatch usage and suggests
right-sizing. Neither knows the context — a low-CPU instance might be a standby
— so I'd treat the output as a list of places to look rather than a list of
changes to make.

**What's actually running.** Going through the console region by region — EC2
instances, RDS databases, S3 buckets, ECS clusters, and what each CloudFront
distribution has as its origin. The bill reflects what exists in the account, so
that's what I'd read rather than starting from a diagram.

**CloudWatch dashboards and alarms, if any.** What's already monitored tells you
what has hurt before. An alarm nobody has touched in a year is either solid or
ignored, and both are worth knowing.

## 3. Where the cost likely sits, for this product

From using the app, the workload splits into parts with very different cost
shapes. That shapes where I'd look hardest.

| Part | Cost driver |
|---|---|
| Dictionary | Storage and egress. Same word returns the same image, so results are cached rather than generated per lookup |
| Other AI — translate, read-aloud, AI search | Per-request cost, whether inference we run or a third-party API. Scales with usage, not user count |
| Media — book files, article thumbnails | Storage and egress |
| Browsing, tabs, search | Effectively free. Runs on the device |
| Content APIs — books, quiz, trending | Cheap if cached, expensive if every request hits origin |

So the two questions I'd want answered early:

**What does one AI request cost, and how many are we doing?** Cost per feature
per day is the number that tells you whether translate or dictionary is the
expensive one. Without it, any optimisation is guesswork.

**How much is data transfer?** At this download volume, egress and CDN misses
are often a larger line than compute, and it's the one people forget to look at
because it doesn't appear as a "service" they chose.

## 4. Specific things I'd check

These are the usual suspects. Each one is cheap to verify and commonly wrong.

**Security group exposure.** What's open to 0.0.0.0/0, particularly SSH and
database ports. On a production EC2 setup I ran, the logs showed constant bot
traffic probing SSH until I removed it from the security group entirely and
moved to Session Manager. Worth checking whether the same exposure exists here.
It's both a security problem and a source of log noise you're paying to store.

**Where secrets live.** Environment files on disk, baked into AMIs, or properly
held in SSM Parameter Store and Secrets Manager. Moving them is low risk and
immediately reduces what a compromised instance gives away.

**CloudWatch log retention.** Log groups default to never expire. On a
production system running for years, this quietly becomes a significant bill.
Setting retention to 30 or 90 days is safe and immediate.

**S3 lifecycle rules.** Old uploads, generated files and backups sitting in
Standard forever. Lifecycle to Infrequent Access or Glacier costs nothing to
configure and doesn't affect anything live.

**Unattached EBS volumes and old snapshots.** Left behind by terminated
instances. Genuinely free money, but I'd check creation dates and tags before
deleting anything, and snapshot first.

**NAT Gateways.** Charged hourly plus per GB. Multiple gateways across AZs when
one would do, or private subnets routing traffic through NAT that could use a
VPC endpoint for S3 instead. A line nobody notices until they look.

**CloudFront hit ratio.** If cache hit rate is low, origin is serving traffic
the CDN should be absorbing. For dictionary images and book files this should be
very high — the same content served repeatedly. A low ratio usually means cache
headers are wrong, not that the CDN is misconfigured.

**Non-production environments.** Dev and staging running 24/7 when they're used
during working hours. Scheduled stop/start is straightforward and low risk.

**Over-provisioned compute and databases.** Compute Optimizer flags these, but
I'd want two weeks of CloudWatch data before acting. A database sized for a
traffic peak that happens twice a year is correctly sized, not wasteful.

**Model choices on AI calls.** Worth checking whether every AI feature needs the
same model. A dictionary lookup and a document summary have very different
requirements, and paying summary prices for lookups adds up fast.

## 5. Metrics and logs I'd look at

**Cost:** Cost Explorer daily granularity by service and tag, Cost Anomaly
Detection, and the data transfer breakdown specifically.

**Compute:** CPU and memory utilisation over two weeks, p50 and p99 together.
Average utilisation alone hides the peaks that justify the capacity.

**Database:** connection counts, slow queries, CPU, storage growth rate, read
replica lag if any.

**Application:** request rate, error rate and p99 latency per endpoint. This is
also what tells you which AI feature is most used, which is the input to the
cost-per-feature question above.

**CloudFront:** hit ratio, origin request rate, egress by distribution.

**Logs:** error patterns and their frequency. High-volume repeated errors cost
money to store and usually indicate something retrying that shouldn't be.

## 6. Identifying genuinely unnecessary usage

The test I'd apply: *if this disappeared, who would notice, and when?*

Usually safe after checking:
- Log retention on groups nobody queries
- Snapshots older than the retention policy
- Volumes unattached for months
- Non-prod environments outside working hours

Looks wasteful but often isn't:
- Low-CPU instances — could be memory-bound, or a failover
- Idle databases — could be a read replica or a reporting copy
- Duplicate-looking resources — could be blue/green or DR

For anything in the second group I'd find the owner, check CloudTrail for recent
access, and if still unsure, stop rather than delete. Something stopped can be
started again in a minute. Something deleted cannot.

## 7. Making changes without disrupting a live app

The order matters more than the changes themselves.

**Safe immediately, no risk to running traffic:**
tags, log retention, S3 lifecycle, budgets, alarms, dashboards.

**Safe after verification:**
deleting unattached volumes and old snapshots, scheduling non-prod shutdowns,
tightening security groups once you're certain what uses them.

**Requires a rollout plan:**
right-sizing instances, database changes, CDN and cache header changes,
architectural moves.

For anything in the third group:

1. Measure first, so there's a baseline to compare against
2. Change staging, watch it
3. One change at a time, so a regression has one obvious cause
4. Deploy during low traffic for this product's users, not mine
5. Watch error rate and p99 for a full day, not ten minutes
6. Keep the rollback ready and know how long it takes

And commitments last. Savings Plans and Reserved Instances lock in current
usage, so buying them before right-sizing locks in the waste. Optimise first,
commit second.

## 8. Monitoring and alerts I'd introduce

Whatever else is missing, these are additive and can't break anything, so
they're day-one work.

**Cost**
- AWS Budgets with a monthly threshold and alerts at 50, 80 and 100 percent
- Cost Anomaly Detection, which catches the accidental spike a monthly budget
  misses until the month is nearly over

**Reliability**
- Error rate above threshold, per service
- p99 latency alarms on the API, and separately on AI endpoints, which have
  different normal ranges
- Database CPU, connection count and free storage
- ALB 5xx and unhealthy host count

**Product-shaped alerts**

These matter as much as the infrastructure ones:
- Store webhook failures, since a missed renewal means a paying user loses Pro
- AI provider error rate and latency, since that's both a user-visible failure
  and a cost signal
- Subscription verification failure rate

**On tooling.** CloudWatch is already there and costs nothing to start using
properly, so that's where I'd begin. If log ingestion and metric costs turn out
to be a meaningful line item, self-hosted Prometheus and Grafana with
Alertmanager is the standard alternative — cheaper to run, but a stack someone
then has to operate, which is a real cost for a small team. I'd make that call
from the cost data rather than by default, and not in week one when reduced
visibility is the last thing you want.

**Discipline around alerts.** An alert nobody acts on trains people to ignore
all alerts. Better six that always mean something than thirty that mostly don't.
Anything that fires without needing action gets tuned or removed.

## 9. Two-week plan

**Week 1 — understand**
- Read the architecture as it exists, not as documented
- Cost Explorer by service and tag, six months
- Fix tagging where it's missing
- Trusted Advisor and Compute Optimizer output
- Audit security groups and where secrets are held
- Set log retention, S3 lifecycle, budgets and anomaly detection
- Build a cost-per-feature view for the AI endpoints
- Write down findings with estimated saving and estimated risk

**Week 2 — act on the safe things**
- Delete verified-unused volumes and snapshots, with snapshots taken first
- Schedule non-prod environments
- Fix CloudFront cache headers if hit ratio is low
- Add the reliability and product alerts
- Propose the larger changes — right-sizing, architecture — with measurements
  attached rather than opinions

Anything with real blast radius gets proposed in week two and done later, with
someone else aware it's happening.

## 10. Where my experience actually is

My AWS work has been building and running infrastructure for apps I've shipped
rather than managing spend at this scale. The most relevant piece was hardening
a live EC2 setup.

It started with SSH. I was deploying over SSH with a key on my machine, and the
logs showed constant bot traffic probing the instance. So I removed SSH from the
security group entirely and moved to Session Manager, which means no open
inbound port and no private key sitting on a laptop that could be lost. Around
the same time I moved environment config out of files on the server into SSM
Parameter Store, so secrets weren't sitting in a directory on disk, and put
nginx in front of the app.

None of that came from a checklist. It came from noticing something in the logs
and reasoning about what was actually exposed.

That's the approach I'd bring here. I haven't done cost optimisation at this
scale and I'd expect week one to turn up things I haven't seen before. What I do
have is the habit of measuring before changing, changing one thing at a time,
and being careful about what's exposed on a system real users depend on.