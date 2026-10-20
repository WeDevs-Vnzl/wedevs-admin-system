/**
 * Typography of rendered markdown (Tailwind classes, theme tokens only). Mirrors `richTextProseClassName`
 * (`components/ui/rich-text/prose.ts`) at document scale, plus GFM task lists and highlighted code blocks.
 */
export const markdownProseClassName = [
  "min-w-0 text-sm leading-relaxed break-words",
  "[&>:first-child]:mt-0 [&>:last-child]:mb-0",
  "[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold",
  "[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-base [&_h4]:font-semibold",
  "[&_p]:my-2",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-0.5",
  "[&_ul.contains-task-list]:list-none [&_ul.contains-task-list]:pl-0",
  "[&_li.task-list-item]:flex [&_li.task-list-item]:items-start [&_li.task-list-item]:gap-2",
  "[&_li.task-list-item_input]:mt-1 [&_li.task-list-item_input]:accent-primary",
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
  "[&_hr]:my-4 [&_hr]:border-border",
  "[&_img]:max-w-full [&_img]:rounded-md",
  "[&_table]:my-3 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:border-collapse",
  "[&_th]:border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
  "[&_td]:border [&_td]:px-2 [&_td]:py-1",
].join(" ");
