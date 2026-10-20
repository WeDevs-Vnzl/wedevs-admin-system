import { DetailGraphToggle } from "@/components/patterns/detail-header";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import type { PaymentStatus } from "@/lib/validators/enums";

type PaymentDetailHeaderProps = {
  payment: {
    id: string;
    code: string;
    status: PaymentStatus;
    /** Client and method line, already localized by the page. */
    description: string;
  };
};

/** Header of `/payments/[id]`: code, client · method, status and the "Detalle | Grafo" toggle (A4). */
export function PaymentDetailHeader({ payment }: PaymentDetailHeaderProps) {
  const detailHref = `/payments/${encodeURIComponent(payment.id)}`;
  return (
    <PageHeader
      title={payment.code}
      description={payment.description}
      views={
        <DetailGraphToggle
          mode="detail"
          detailHref={detailHref}
          graphHref={`${detailHref}/graph`}
        />
      }
      actions={<StatusBadge enumName="PaymentStatus" value={payment.status} />}
    />
  );
}
