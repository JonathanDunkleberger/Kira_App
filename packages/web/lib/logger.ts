export type LogFields = Record<string, unknown>;

const withFields = (msg: string, fields?: LogFields) =>
  fields && Object.keys(fields).length ? `${msg} ${JSON.stringify(fields)}` : msg;

export const logger = {
  info: (msg: string, fields?: LogFields) => console.log(withFields(msg, fields)),
  error: (msg: string, fields?: LogFields) => console.error(withFields(msg, fields)),
};
