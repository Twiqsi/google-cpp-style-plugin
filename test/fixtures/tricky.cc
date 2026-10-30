// Copyright 2026 Example

#include "tricky.h"

#include <cstdint>
#include <cstring>
#include <iostream>
#include <map>
#include <string>
#include <utility>
#include <vector>

#define LAB_CHECK(cond)          \
  do {                           \
    if (!(cond)) std::abort();   \
  } while (0)

extern "C" {
int c_function(int x);
}

namespace lab::detail {

constexpr int64_t kBillion = 1'000'000'000;
constexpr char kRaw[] = R"(text with { braces } and "quotes" // not comment)";

struct Pair {
  int first = 0;
  int second = 0;
};

class Int2026 {
 public:
  Int2026() = default;
  explicit Int2026(int64_t value) : value_(value) {}
  Int2026(const Int2026&) = default;
  Int2026(Int2026&& other) noexcept = default;

  Int2026& operator+=(const Int2026& rhs);
  Int2026 operator-() const;
  friend std::ostream& operator<<(std::ostream& out, const Int2026& x);
  friend bool operator<(const Int2026& a, const Int2026& b);

  int64_t value() const { return value_; }

 protected:
  void Normalize();

 private:
  static constexpr int kDigits = 2026;
  int64_t value_ = 0;
  uint8_t digits_[kDigits] = {};
};

Int2026& Int2026::operator+=(const Int2026& rhs) {
  value_ += rhs.value_;
  return *this;
}

std::ostream& operator<<(std::ostream& out, const Int2026& x) {
  out << x.value_ << '\n' << '{' << "}" << std::endl;
  return out;
}

int Compute(const std::vector<std::pair<int, int>>& pairs, int* out_count,
            std::map<std::string, int>* index) {
  int count = 0;
  int sum = -1;
  for (size_t i = 0; i < pairs.size() && count >= 0; ++i) {
    const auto& [left, right] = pairs[i];
    sum += left * right - (left & 0xFF) | (right ^ ~left);
    if (left < right && right > 0) {
      ++count;
    }
    *out_count = count > 10 ? 10 : count;
    sum = sum << 2 >> 1;
    int* p = &sum;
    *p = -*p;
  }
  do {
    --count;
  } while (count > 0);
  if (sum == 0 ||
      count != 0) {
    (*index)["key"] = sum;
  }
  auto add = [&sum](int x) -> int { return sum + x; };
  auto mul = [=](int x) { return x * 2; };
  std::vector<int> values = {
      1, 2, 3,
      4, 5, 6,
  };
  Pair pair{1, 2};
  std::string message = "a" + std::string("b");
  bool is_less = Int2026(1) < Int2026(2);
  double ratio = 1.5e-3 * static_cast<double>(sum);
  char buffer[16];
  std::memset(buffer, 0, sizeof(buffer));
  int result = c_function(sum) +
               add(1) +
               mul(2);
  return values.empty() ? -1 : result + static_cast<int>(ratio) + is_less +
                                   pair.first;
}

template <typename T, int kSize>
class FixedArray {
 public:
  T& operator[](int index) { return data_[index]; }
  const T* data() const { return data_; }

 private:
  T data_[kSize];
};

}  // namespace lab::detail
