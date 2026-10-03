import { Course } from '../models/index.js'
import { generateCourseCode } from '../utils/courseCode.js'

export async function ensureCourseCodes() {
  const missing = await Course.find({ $or: [{ courseCode: { $exists: false } }, { courseCode: null }, { courseCode: '' }] }).select('_id').lean()
  for (const course of missing) {
    let saved = false
    while (!saved) {
      try {
        const result = await Course.updateOne({ _id: course._id, $or: [{ courseCode: { $exists: false } }, { courseCode: null }, { courseCode: '' }] }, { $set: { courseCode: generateCourseCode() } })
        saved = result.modifiedCount === 1 || result.matchedCount === 0
      } catch (error) {
        if (error?.code !== 11000) throw error
      }
    }
  }
}
