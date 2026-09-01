# 🧩 Giới thiệu Plugin
Một plugin SillyTavern dùng để tự động đính kèm lệnh khi gửi tin nhắn, đồng thời hỗ trợ gửi ở chế độ hoàn toàn tàng hình.

# ✨ Tính năng cốt lõi
- **Quản lý đa lệnh**: Hỗ trợ thêm mới, chỉnh sửa, xóa, bật/tắt nhiều lệnh.
- **Liên kết nhân vật (Chế độ Mắt xích)**: Lệnh có thể liên kết với một nhân vật cụ thể. Khi chuyển sang nhân vật đó sẽ tự động chọn bật, khi chuyển sang nhân vật khác sẽ tự động bỏ chọn.
- **Điều khiển toàn cục (Chế độ Dấu sao)**: Sau khi thiết lập làm lệnh mặc định, trạng thái bật/tắt của nó không bị ảnh hưởng bởi việc chuyển đổi nhân vật, hoàn toàn do điều khiển thủ công.
- **Tiêm (Inject) với trọng số cao nhất**: Tự động ghép nối các lệnh đã bật trước khi gửi, giảm thiểu việc bỏ sót các ràng buộc hệ thống.
- **Chế độ tàng hình không dấu vết**: Đính kèm lệnh vào đầu vào của người dùng dưới dạng HTML comment, không ảnh hưởng đến việc đọc thông thường.
- **Đại thanh trừng lịch sử**: Tự động dọn dẹp các khối lệnh cũ trong lịch sử tin nhắn trước khi gửi, ngăn chặn việc tích tụ dữ liệu.

# 📖 Hướng dẫn sử dụng cơ bản
Để giúp bạn đạt được tự động hóa một cách "vô hình", vui lòng thiết lập biểu tượng ở bên phải lệnh theo nhu cầu:

1.  **Muốn lệnh "chỉ có hiệu lực với một nhân vật nào đó"**:
    * Thắp sáng **"Mắt xích"** 🔗: Vào đoạn chat tự động bật, thoát đoạn chat tự động tắt.
2.  **Muốn lệnh "áp dụng toàn cục"**:
    * Thắp sáng **"Dấu sao"** ⭐: Chế độ thủ công. Bạn bật thì nó luôn bật, bạn tắt thì nó luôn tắt, việc chuyển đổi nhân vật không ảnh hưởng đến nó.
3.  **Không bấm Mắt xích cũng không bấm Dấu sao**:
    * Được xem là lệnh tạm thời. Chỉ cần bạn chuyển đổi nhân vật, nó sẽ tự động bỏ chọn và tắt đi.