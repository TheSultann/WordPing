-- AlterTable
ALTER TABLE "User" ADD COLUMN     "doneTodayCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastDoneDate" TIMESTAMP(3),
ADD COLUMN     "lastNotificationAt" TIMESTAMP(3),
ADD COLUMN     "maxNotificationsPerDay" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "notificationIntervalMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "notificationsDate" TIMESTAMP(3),
ADD COLUMN     "notificationsSentToday" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "quietHoursEndMinutes" INTEGER NOT NULL DEFAULT 1380,
ADD COLUMN     "quietHoursStartMinutes" INTEGER NOT NULL DEFAULT 480;

