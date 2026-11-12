const UTC_DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CloudflareUsageCounterTracker {
  constructor(model) {
    this.model = model;
    this.recordId = null;
    this.baselineCount = undefined;
    this.successfulReservationCounts = [];
    this.hasRecordIdConflict = false;
    this.reservationOutcomeUncertain = false;
  }

  wrapFindOneAndUpdate(originalMethod) {
    const tracker = this;
    return async function trackedFindOneAndUpdate(filter, update, ...options) {
      const recordId = filter?._id;
      const reservation = isUsageReservation(filter, update);

      if (reservation) await tracker.trackRecordId(recordId);

      let result;
      try {
        result = await originalMethod.call(this, filter, update, ...options);
      } catch (error) {
        // Duplicate-key upsert races are retried by the production service and did not
        // reserve through this operation. Other write errors can have an ambiguous outcome.
        if (reservation && error?.code !== 11000) tracker.reservationOutcomeUncertain = true;
        throw error;
      }
      if (reservation && recordId === tracker.recordId && Number.isInteger(result?.count)) {
        tracker.baselineCount ??= result.count - 1;
        tracker.successfulReservationCounts.push(result.count);
      }
      return result;
    };
  }

  async trackRecordId(recordId) {
    if (this.recordId === null) {
      this.recordId = recordId;
      return;
    }
    if (this.recordId !== recordId) this.hasRecordIdConflict = true;
  }

  async verifySingleReservation() {
    if (this.hasRecordIdConflict || this.recordId === null || this.baselineCount === undefined
      || this.successfulReservationCounts.length !== 1) return false;

    const reservedCount = this.successfulReservationCounts[0];
    if (reservedCount !== this.baselineCount + 1) return false;
    const current = await this.model.findById(this.recordId).lean();
    return current?.count === reservedCount;
  }

  async restoreTrackedReservation() {
    if (this.reservationOutcomeUncertain) return false;
    if (this.successfulReservationCounts.length === 0) return true;
    if (this.hasRecordIdConflict || this.recordId === null || this.baselineCount === undefined
      || this.successfulReservationCounts.length !== 1) return false;

    const reservedCount = this.successfulReservationCounts[0];
    if (!Number.isInteger(reservedCount)) return false;
    const current = await this.model.findById(this.recordId).lean();
    if (!current || current.count === this.baselineCount) return true;
    if (current.count !== reservedCount) return false;

    // Compare-and-set restores only the increment observed from this reservation.
    const restored = await this.model.updateOne(
      { _id: this.recordId, count: reservedCount },
      { $inc: { count: -1 } },
    );
    return restored.modifiedCount === 1;
  }
}

const isUsageReservation = (filter, update) => typeof filter?._id === 'string'
  && UTC_DAY_KEY_PATTERN.test(filter._id)
  && update?.$inc?.count === 1;
