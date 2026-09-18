import { Router } from "express";
import { Meeting, MeetingActionItem } from "../db/models/index.js";
import { requireAnyRole } from "../middleware/auth.js";
import { handle, ok, pagination, page } from "./helpers.js";
import { dateOnly } from "./serializers.js";

/**
 * Meetings and their action items (inventory §2.3, route 12).
 *
 * `requireAnyRole` per D-2.
 *
 * Action items are nested under their meeting, matching the page's card
 * layout and the `meeting_action_items(*)` joined select it used — another
 * join the Mongo shim drops today, which is why every meeting currently
 * renders with no action items at all.
 */

export const meetingsRouter = Router();

meetingsRouter.get(
  "/",
  ...requireAnyRole,
  handle(async (req, res) => {
    const { limit, offset } = pagination(req);

    const [meetings, total] = await Promise.all([
      Meeting.find({}).sort({ meetingDate: -1 }).skip(offset).limit(limit).lean(),
      Meeting.countDocuments({}),
    ]);

    // One query for every action item on this page, grouped in memory —
    // rather than one query per meeting.
    const items = meetings.length
      ? await MeetingActionItem.find({ meetingId: { $in: meetings.map((m) => m._id) } })
          .sort({ dueDate: 1 })
          .lean()
      : [];

    const itemsByMeeting = new Map<string, typeof items>();
    for (const item of items) {
      const bucket = itemsByMeeting.get(item.meetingId) ?? [];
      bucket.push(item);
      itemsByMeeting.set(item.meetingId, bucket);
    }

    ok(
      res,
      page(
        meetings.map((meeting) => ({
          id: meeting._id,
          title: meeting.title,
          meeting_date: dateOnly(meeting.meetingDate),
          attendees: meeting.attendees ?? [],
          source_notes: meeting.sourceNotes,
          action_items: (itemsByMeeting.get(meeting._id) ?? []).map((item) => ({
            id: item._id,
            description: item.description,
            owner_name: item.ownerName,
            due_date: dateOnly(item.dueDate),
            status: item.status,
          })),
        })),
        total,
        { limit, offset },
      ),
    );
  }),
);
