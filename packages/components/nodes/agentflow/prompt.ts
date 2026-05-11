export const DEFAULT_SUMMARIZER_TEMPLATE = `Hãy tóm tắt dần dần cuộc hội thoại được cung cấp và trả về bản tóm tắt mới.

VÍ DỤ:
Người dùng: Bạn nghĩ trí tuệ nhân tạo là điều tốt vì sao?
AI: Vì trí tuệ nhân tạo sẽ giúp con người phát huy hết tiềm năng của mình.

Tóm tắt mới:
Người dùng hỏi AI nghĩ gì về trí tuệ nhân tạo. AI cho rằng trí tuệ nhân tạo là điều tốt vì nó sẽ giúp con người phát huy hết tiềm năng.
KẾT THÚC VÍ DỤ

Cuộc hội thoại:
{conversation}

Tóm tắt mới:`

export const DEFAULT_HUMAN_INPUT_DESCRIPTION = `Tóm tắt cuộc hội thoại giữa người dùng và trợ lý, nhắc lại tin nhắn cuối cùng từ trợ lý, và hỏi người dùng muốn tiếp tục hay có phản hồi gì không.
- Bắt đầu bằng cách nắm bắt các điểm chính của cuộc hội thoại, đảm bảo phản ánh các ý tưởng và chủ đề chính đã thảo luận.
- Sau đó, trình bày lại chính xác tin nhắn cuối cùng của trợ lý để duy trì tính liên tục. Đảm bảo toàn bộ tin nhắn được trình bày lại.
- Cuối cùng, hỏi người dùng muốn tiếp tục hay có phản hồi gì về tin nhắn cuối của trợ lý.

## Định dạng đầu ra - Đầu ra nên được cấu trúc thành ba phần dạng văn bản:

- Tóm tắt cuộc hội thoại (1-3 câu).
- Tin nhắn cuối của trợ lý (chính xác như đã xuất hiện).
- Hỏi người dùng muốn tiếp tục hay có phản hồi gì. Không cần giải thích thêm.
`

export const DEFAULT_HUMAN_INPUT_DESCRIPTION_HTML = `<p>Tóm tắt cuộc hội thoại giữa người dùng và trợ lý, nhắc lại tin nhắn cuối cùng từ trợ lý, và hỏi người dùng muốn tiếp tục hay có phản hồi gì không.</p>
<ul>
<li>Bắt đầu bằng cách nắm bắt các điểm chính của cuộc hội thoại, đảm bảo phản ánh các ý tưởng và chủ đề chính đã thảo luận.</li>
<li>Sau đó, trình bày lại chính xác tin nhắn cuối cùng của trợ lý để duy trì tính liên tục. Đảm bảo toàn bộ tin nhắn được trình bày lại.</li>
<li>Cuối cùng, hỏi người dùng muốn tiếp tục hay có phản hồi gì về tin nhắn cuối của trợ lý.</li>
</ul>
<h2 id="output-format">Định dạng đầu ra - Đầu ra nên được cấu trúc thành ba phần dạng văn bản:</h2>
<ul>
<li>Tóm tắt cuộc hội thoại (1-3 câu).</li>
<li>Tin nhắn cuối của trợ lý (chính xác như đã xuất hiện).</li>
<li>Hỏi người dùng muốn tiếp tục hay có phản hồi gì. Không cần giải thích thêm.</li>
</ul>
`

export const CONDITION_AGENT_SYSTEM_PROMPT = `<p>Bạn là một phần của hệ thống đa tác tử được thiết kế để phối hợp và thực thi agent dễ dàng. Nhiệm vụ của bạn là phân tích đầu vào và chọn một kịch bản phù hợp nhất từ danh sách kịch bản được cung cấp.</p>
    <ul>
        <li><strong>Đầu vào</strong>: Một chuỗi ký tự đại diện cho câu hỏi, tin nhắn hoặc dữ liệu của người dùng.</li>
        <li><strong>Kịch bản</strong>: Danh sách các kịch bản được định nghĩa trước liên quan đến đầu vào.</li>
        <li><strong>Hướng dẫn</strong>: Xác định kịch bản nào phù hợp nhất với đầu vào.</li>
    </ul>
    <h2>Các bước</h2>
    <ol>
        <li><strong>Đọc chuỗi đầu vào</strong> và danh sách kịch bản.</li>
        <li><strong>Phân tích nội dung đầu vào</strong> để xác định chủ đề hoặc ý định chính.</li>
        <li><strong>So sánh đầu vào với từng kịch bản</strong>: Đánh giá mức độ phù hợp giữa chủ đề/ý định của đầu vào với từng kịch bản và chọn kịch bản phù hợp nhất.</li>
        <li><strong>Trả về kết quả</strong>: Trả về kịch bản được chọn theo định dạng JSON được chỉ định.</li>
    </ol>
    <h2>Định dạng đầu ra</h2>
    <p>Đầu ra phải là một đối tượng JSON đặt tên cho kịch bản được chọn, như sau: <code>{"output": "<tên_kịch_bản_được_chọn>"}</code>. Không cần giải thích.</p>
    <h2>Ví dụ</h2>
    <ol>
       <li>
            <p><strong>Đầu vào</strong>: <code>{"input": "Xin chào", "scenarios": ["người dùng hỏi về AI", "người dùng không hỏi về AI"], "instruction": "Kiểm tra xem người dùng có đang hỏi về AI không."}</code></p>
            <p><strong>Đầu ra</strong>: <code>{"output": "người dùng không hỏi về AI"}</code></p>
        </li>
        <li>
            <p><strong>Đầu vào</strong>: <code>{"input": "AIGC là gì?", "scenarios": ["người dùng hỏi về AI", "người dùng hỏi về thời tiết"], "instruction": "Kiểm tra xem người dùng có đang hỏi về chủ đề AI không."}</code></p>
            <p><strong>Đầu ra</strong>: <code>{"output": "người dùng hỏi về AI"}</code></p>
        </li>
        <li>
            <p><strong>Đầu vào</strong>: <code>{"input": "Giải thích deep learning cho tôi?", "scenarios": ["người dùng quan tâm đến AI", "người dùng muốn đặt đồ ăn"], "instruction": "Xác định xem người dùng có quan tâm đến AI không."}</code></p>
            <p><strong>Đầu ra</strong>: <code>{"output": "người dùng quan tâm đến AI"}</code></p>
        </li>
    </ol>
    <h2>Lưu ý</h2>
    <ul>
        <li>Đảm bảo các kịch bản đầu vào phù hợp với các câu hỏi tiềm năng của người dùng để so khớp chính xác.</li>
        <li>KHÔNG bao gồm bất cứ thứ gì khác ngoài JSON trong phản hồi của bạn.</li>
    </ul>`
